import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';
import { frameStructure, frameXyz, frameLammpsDump, readMdTransfer, mdTransferKey, dftTransferKey, listMdTrajectories, saveMdTrajectories, saveMdTrajectory, removeMdTrajectory } from '../lib/md-workspace.ts';
import { parseMdText } from '../lib/md-parser.ts';
import { defaultMdSettings } from '../lib/md-types.ts';
import { fractionalVectorToCartesian } from '../lib/crystal-cell.ts';
import { buildMdSidebarTrajectories, mdRecordMatchesCloudSource, resolveMdProjectTrajectoryCounts } from '../lib/md-sidebar.ts';

async function readStoredMdTrajectory(id: string) {
  return new Promise<{
    metadata: { file?: Blob; sourceBytes?: ArrayBuffer; name?: string };
    source?: { sourceBytes?: ArrayBuffer; sourceType?: string };
  }>((resolve, reject) => {
    const opened = indexedDB.open('phynite-md-studio', 2);
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const database = opened.result;
      const transaction = database.transaction(['trajectories', 'sources']);
      const metadataRequest = transaction.objectStore('trajectories').get(id);
      const sourceRequest = transaction.objectStore('sources').get(id);
      transaction.oncomplete = () => {
        database.close();
        resolve({ metadata: metadataRequest.result, source: sourceRequest.result });
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

async function putLegacyMdTrajectory(record: Record<string, unknown>) {
  await new Promise<void>((resolve, reject) => {
    const opened = indexedDB.open('phynite-md-studio', 2);
    opened.onerror = () => reject(opened.error);
    opened.onsuccess = () => {
      const database = opened.result;
      const transaction = database.transaction('trajectories', 'readwrite');
      transaction.objectStore('trajectories').put(record);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

test('finite structures transfer with a padded cell and preserve interatomic geometry', () => {
  const f = parseMdText('2\nmolecule\nH -2 5 10\nO 1 7 10\n').frames[0];
  const structure = frameStructure(f, 'molecule');
  const restored = structure.atoms.map(a => fractionalVectorToCartesian([a.x, a.y, a.z], structure.lattice.vectors!));
  assert.deepEqual(restored[1].map((v, i) => v - restored[0][i]), [3, 2, 0]);
  const xyz = parseMdText(frameXyz(f, 'molecule')).frames[0];
  assert.deepEqual(xyz.periodic, [false, false, false]);
  assert.deepEqual(xyz.positions, restored.flat());
});
test('MD transfers validate owner, chemical species, atom limits and lattice', () => {
  const payload = { ...frameStructure(parseMdText('1\n\nCu 0 0 0\n').frames[0], 'Cu'), owner: 'alice' };
  assert.equal(readMdTransfer(JSON.stringify(payload), 'alice').atoms.length, 1);
  assert.throws(() => readMdTransfer(JSON.stringify(payload), 'bob'), /another account/);
  assert.notEqual(mdTransferKey('alice'), mdTransferKey('bob'));
  assert.notEqual(dftTransferKey('alice'), dftTransferKey('bob'));
  assert.throws(() => readMdTransfer(JSON.stringify({ ...payload, atoms: [{ ...payload.atoms[0], species: 'Xx' }] }), 'alice'), /valid elements/);
  assert.throws(() => readMdTransfer(JSON.stringify({ ...payload, atoms: Array(1601).fill(payload.atoms[0]) }), 'alice'), /1,600/);
  assert.throws(() => readMdTransfer(JSON.stringify({ ...payload, lattice: { ...payload.lattice, a: 0 } }), 'alice'), /positive/);
});
test('LAMMPS frame export preserves a general triclinic cell, origin, coordinates and chemical identities', () => {
  const frame = parseMdText('2\nLattice="8 1 0 2 7 1 0 1 6" pbc="T F T"\nCu 4 6 8\nNi 5 9 10\n').frames[0];
  frame.origin = [3, 4, 5]; frame.timestep = 1200; frame.ids = ['7', '19'];
  const roundTrip = parseMdText(frameLammpsDump(frame), 'frame.dump').frames[0];
  assert.deepEqual(roundTrip.vectors, frame.vectors);
  assert.deepEqual(roundTrip.origin, frame.origin);
  assert.deepEqual(roundTrip.periodic, frame.periodic);
  assert.deepEqual(roundTrip.positions, frame.positions);
  assert.deepEqual(roundTrip.ids, frame.ids);
  assert.deepEqual(roundTrip.species, frame.species);
  assert.equal(roundTrip.timestep, 1200);
});
test('LAMMPS export assigns valid IDs to replicated atoms without guessing chemical elements', () => {
  const frame = parseMdText('2\n\n1 0 0 0\n2 1 2 3\n').frames[0];
  frame.ids = ['1:0,0,0', '1:1,0,0'];
  const text = frameLammpsDump(frame);
  assert.ok(!text.includes(' element'));
  const roundTrip = parseMdText(text, 'replica.dump').frames[0];
  assert.deepEqual(roundTrip.ids, ['1', '2']);
  assert.deepEqual(roundTrip.species, ['1', '2']);
  assert.deepEqual(roundTrip.positions, frame.positions);
  assert.throws(() => frameLammpsDump({ ...frame, positions: [NaN, 0, 0] }), /finite coordinates/);
});
test('saved files and pipelines are isolated by owner and deletion checks ownership', async () => {
  const settings = defaultMdSettings();
  await saveMdTrajectory({ id: 'alice:one', owner: 'alice', projectId: 'study', name: 'one.xyz', file: new Blob(['one']), createdAt: '2026-09-08', settings });
  await saveMdTrajectory({ id: 'bob:one', owner: 'bob', projectId: 'study', name: 'two.xyz', file: new Blob(['two']), createdAt: '2026-09-08', settings });
  assert.deepEqual((await listMdTrajectories('alice')).map(r => r.name), ['one.xyz']);
  await removeMdTrajectory('bob', 'alice:one');
  assert.equal((await listMdTrajectories('alice')).length, 1);
  await removeMdTrajectory('alice', 'alice:one');
  assert.equal((await listMdTrajectories('alice')).length, 0);
  assert.equal((await listMdTrajectories('bob')).length, 1);
});
test('device trajectory persistence stores source bytes once and reconstructs a browser Blob', async () => {
  const owner = 'buffer-storage-owner';
  const id = `${owner}:one`;
  await saveMdTrajectory({
    id,
    owner,
    projectId: 'storage-test',
    name: 'source.xyz',
    file: new Blob(['1\nsource\nCu 0 0 0\n'], { type: 'chemical/x-xyz' }),
    createdAt: '2026-09-20',
    settings: defaultMdSettings(),
  });

  const stored = await readStoredMdTrajectory(id);
  assert.equal(stored.metadata.file, undefined);
  assert.equal(stored.metadata.sourceBytes, undefined);
  assert.ok(stored.source?.sourceBytes instanceof ArrayBuffer);
  assert.equal(stored.source?.sourceType, 'chemical/x-xyz');

  const [firstHydrated] = await listMdTrajectories(owner);
  await saveMdTrajectory({
    ...firstHydrated,
    name: 'renamed source',
    file: new Blob(['replacement bytes that must not overwrite the immutable source']),
  });
  const updated = await readStoredMdTrajectory(id);
  assert.equal(updated.metadata.name, 'renamed source');
  assert.equal(new TextDecoder().decode(updated.source?.sourceBytes), '1\nsource\nCu 0 0 0\n');

  const [hydrated] = await listMdTrajectories(owner);
  assert.equal(hydrated.file.type, 'chemical/x-xyz');
  assert.equal(await hydrated.file.text(), '1\nsource\nCu 0 0 0\n');
  await removeMdTrajectory(owner, id);
});
test('device trajectory persistence reads and migrates legacy Blob and inline ArrayBuffer records', async () => {
  const owner = 'legacy-storage-owner';
  const settings = defaultMdSettings();
  const blobId = `${owner}:blob`;
  const bufferId = `${owner}:buffer`;
  await putLegacyMdTrajectory({
    id: blobId,
    owner,
    projectId: 'legacy',
    name: 'legacy.xyz',
    file: new Blob(['legacy blob'], { type: 'chemical/x-xyz' }),
    createdAt: '2026-09-18',
    settings,
  });
  await putLegacyMdTrajectory({
    id: bufferId,
    owner,
    projectId: 'legacy',
    name: 'legacy.dump',
    sourceBytes: new TextEncoder().encode('legacy buffer').buffer,
    sourceType: 'text/plain',
    createdAt: '2026-09-19',
    settings,
  });

  const legacy = await listMdTrajectories(owner);
  assert.deepEqual(await Promise.all(legacy.map(record => record.file.text())), ['legacy blob', 'legacy buffer']);
  assert.deepEqual(legacy.map(record => record.file.type), ['chemical/x-xyz', 'text/plain']);

  await saveMdTrajectories(legacy.map(record => ({ ...record, projectId: 'migrated' })));
  const migratedBlob = await readStoredMdTrajectory(blobId);
  const migratedBuffer = await readStoredMdTrajectory(bufferId);
  assert.equal(migratedBlob.metadata.file, undefined);
  assert.equal(migratedBuffer.metadata.sourceBytes, undefined);
  assert.equal(new TextDecoder().decode(migratedBlob.source?.sourceBytes), 'legacy blob');
  assert.equal(new TextDecoder().decode(migratedBuffer.source?.sourceBytes), 'legacy buffer');

  await removeMdTrajectory(owner, blobId);
  await removeMdTrajectory(owner, bufferId);
});
test('project records rename in one batch without replacing their parser filenames', async () => {
  const owner = 'batch-rename-owner';
  const settings = defaultMdSettings();
  await saveMdTrajectories([
    { id: `${owner}:one`, owner, projectId: 'old study', name: 'Copper heating', sourceFilename: 'cu.dump', file: new Blob(['one']), createdAt: '2026-09-08', settings },
    { id: `${owner}:two`, owner, projectId: 'old study', name: 'Copper cooling', sourceFilename: 'cu.xyz', file: new Blob(['two']), createdAt: '2026-09-09', settings },
  ]);
  const renamed = (await listMdTrajectories(owner)).map(record => ({ ...record, projectId: 'new study' }));
  await saveMdTrajectories(renamed);
  const stored = await listMdTrajectories(owner);
  assert.deepEqual(stored.map(record => record.projectId), ['new study', 'new study']);
  assert.deepEqual(stored.map(record => record.name), ['Copper heating', 'Copper cooling']);
  assert.deepEqual(stored.map(record => record.sourceFilename), ['cu.dump', 'cu.xyz']);
  await Promise.all(stored.map(record => removeMdTrajectory(owner, record.id)));
});
test('cloud projects keep unsynced device structures visible and countable', () => {
  const settings = defaultMdSettings();
  const local = {
    id: 'local-zinc', owner: 'alice', projectId: 'project-tes', projectName: 'tes', name: 'ZnNi2O4 study', sourceFilename: 'ZnNi2O4 (1).cif',
    file: new Blob(['cif']), createdAt: '2026-09-11', settings, syncState: 'pending' as const,
  };
  const rows = buildMdSidebarTrajectories([local], [], 'tes', 'project-tes');
  assert.deepEqual(rows.map(row => ({ id: row.id, filename: row.filename, format: row.format, storage: row.storage })), [
    { id: 'local-zinc', filename: 'ZnNi2O4 study', format: 'CIF', storage: 'device' },
  ]);
});
test('MD project counts use project metadata and fall back to trajectory inventory', async () => {
  const requested: string[] = [];
  const counts = await resolveMdProjectTrajectoryCounts([
    { id: 'current-api', mdTrajectoryCount: 4 },
    { id: 'legacy-api' },
    { id: 'unavailable-api' },
  ], async (projectId) => {
    requested.push(projectId);
    if (projectId === 'unavailable-api') throw new Error('offline');
    return [{ id: 'one' }, { id: 'two' }];
  });
  assert.deepEqual(requested, ['legacy-api', 'unavailable-api']);
  assert.deepEqual(counts, { 'current-api': 4, 'legacy-api': 2 });
});
test('cloud projects keep cached trajectories visible when the cloud list is temporarily unavailable', () => {
  const settings = defaultMdSettings();
  const cached = {
    id: 'cached-nickel', owner: 'alice', projectId: 'stale project name', name: 'NiMn2O4', sourceFilename: 'NiMn2O4.cif',
    file: new Blob(['cif']), createdAt: '2026-09-12', settings,
    cloud: { trajectoryId: 'remote-nickel', projectId: 'project-tes', sha256: 'abc', uploadedAt: '2026-09-12', settingsSignature: '{}' },
  };
  const rows = buildMdSidebarTrajectories([cached], [], 'tes', 'project-tes');
  assert.deepEqual(rows.map(row => ({ id: row.id, filename: row.filename, storage: row.storage })), [
    { id: 'cached-nickel', filename: 'NiMn2O4', storage: 'device' },
  ]);
});
test('cloud projects collapse duplicate device caches for one cloud trajectory', () => {
  const settings = defaultMdSettings();
  const cloud = { trajectoryId: 'remote-zinc', projectId: 'project-tes', sha256: 'abc', uploadedAt: '2026-09-11', settingsSignature: '{}' };
  const older = {
    id: 'cached-zinc-old', owner: 'alice', projectId: 'project-tes', projectName: 'tes', name: 'ZnNi2O4', sourceFilename: 'ZnNi2O4.cif',
    file: new Blob(['cif']), createdAt: '2026-09-11', settings, cloud,
  };
  const newer = { ...older, id: 'cached-zinc-new', createdAt: '2026-09-12' };
  const rows = buildMdSidebarTrajectories([older, newer], [], 'tes', 'project-tes');
  assert.deepEqual(rows.map(row => ({ id: row.id, filename: row.filename, storage: row.storage })), [
    { id: 'cached-zinc-new', filename: 'ZnNi2O4', storage: 'device' },
  ]);
});
test('cloud project structures deduplicate their cached device copy', () => {
  const settings = defaultMdSettings();
  const cached = {
    id: 'cached-zinc', owner: 'alice', projectId: 'tes', name: 'Spinel', sourceFilename: 'spinel.cif',
    file: new Blob(['cif']), createdAt: '2026-09-11', settings,
    cloud: { trajectoryId: 'remote-zinc', projectId: 'project-tes', sha256: 'abc', uploadedAt: '2026-09-11', settingsSignature: '{}' },
  };
  const remote = {
    id: 'remote-zinc', projectId: 'project-tes', filename: 'spinel.cif', name: 'Spinel', sizeBytes: 3, format: 'cif' as const,
    sha256: 'abc', status: 'READY' as const, createdAt: '2026-09-11', updatedAt: '2026-09-11', revision: 0,
  };
  const rows = buildMdSidebarTrajectories([cached], [remote], 'tes', 'project-tes');
  assert.deepEqual(rows.map(row => ({ id: row.id, storage: row.storage })), [{ id: 'remote:remote-zinc', storage: 'cloud' }]);
  assert.equal(mdRecordMatchesCloudSource(cached, remote), true);
  assert.equal(mdRecordMatchesCloudSource({ ...cached, sourceFilename: 'another.cif' }, remote), false);
  assert.equal(mdRecordMatchesCloudSource({ ...cached, file: new Blob(['different size']) }, remote), false);
});

test('structure parser identifies CIF text without .cif extension via content-based detection', () => {
  const cifText = `data_test
_cell_length_a 5.43
_cell_length_b 5.43
_cell_length_c 5.43
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Si1 Si 0.0 0.0 0.0
`;
  // Test with fileName lacking extension (e.g. renamed structure)
  const result = parseMdText(cifText, 'Silicon Renamed');
  assert.equal(result.index.format, 'structure');
  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0].species[0], 'Si');
});
