import { cartesianToFractionalWithVectors, cellVectorsFromLattice, latticeFromCellVectors, validateCell } from './crystal-cell.ts';
import type { MdFrame, MdSettings, MdTrajectoryRecord } from './md-types.ts';

export const mdTransferKey = (owner: string) => 'phynite:md-frame-transfer:v2:' + owner;
export const dftTransferKey = (owner: string) => 'phynite:dft-to-md-transfer:v1:' + owner;
export const mdLastActiveKey = (owner: string) => 'phynite:md-last-active:v1:' + owner;
const elements = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' '));
export const isMdElement = (value: string) => elements.has(value);
export function readMdTransfer(raw: string, owner: string) {
  const value = JSON.parse(raw) as ReturnType<typeof frameStructure> & { owner: string; sourceTrajectory?: string; sourceFrame?: number };
  if (value.owner !== owner) throw new Error('This MD frame belongs to another account.');
  if (!Array.isArray(value.atoms) || !value.atoms.length || value.atoms.length > 1600 ||
    value.atoms.some(a => !a || !isMdElement(a.species) || ![a.x, a.y, a.z].every(Number.isFinite))) throw new Error('MD transfer needs 1–1,600 atoms with valid elements and finite coordinates.');
  if (new Set(value.atoms.map(a => a.id)).size !== value.atoms.length) throw new Error('MD transfer contains duplicate particle IDs.');
  cellVectorsFromLattice(value.lattice);
  return value;
}
export function frameStructure(frame: MdFrame, name: string) {
  const lattice = { ...latticeFromCellVectors(frame.vectors), periodic: frame.periodic };
  const atoms = frame.ids.map((id, i) => {
    const [x, y, z] = cartesianToFractionalWithVectors([frame.positions[3 * i] - frame.origin[0], frame.positions[3 * i + 1] - frame.origin[1], frame.positions[3 * i + 2] - frame.origin[2]], frame.vectors);
    return { id, species: frame.species[i], x, y, z };
  });
  return { atoms, lattice, name };
}
export function frameXyz(frame: MdFrame, name: string) {
  const header = 'Lattice="' + frame.vectors.flat().join(' ') + '" Properties=species:S:1:pos:R:3 pbc="' + frame.periodic.map(v => v ? 'T' : 'F').join(' ') + '" Name="' + name.replace(/["\n\r]/g, '') + '"';
  return [frame.ids.length, header, ...frame.ids.map((_, i) => frame.species[i] + ' ' + [0, 1, 2].map(a => (frame.positions[3 * i + a] - frame.origin[a]).toPrecision(12)).join(' '))].join('\n') + '\n';
}
export function frameLammpsDump(frame: MdFrame) {
  validateCell(frame.vectors);
  if (!frame.ids.length || frame.positions.length !== frame.ids.length * 3 || frame.species.length !== frame.ids.length || !frame.positions.every(Number.isFinite)) throw new Error('LAMMPS export needs a nonempty frame with finite coordinates.');
  const species = [...new Set(frame.species)];
  const chemical = species.every(isMdElement);
  const preserveIds = frame.ids.every(id => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))) && new Set(frame.ids).size === frame.ids.length;
  const step = Number.isSafeInteger(frame.timestep) && frame.timestep! >= 0 ? frame.timestep! : frame.index;
  const rows = [
    'ITEM: TIMESTEP', String(step), 'ITEM: NUMBER OF ATOMS', String(frame.ids.length),
    'ITEM: BOX BOUNDS abc origin ' + frame.periodic.map(p => p ? 'pp' : 'ff').join(' '),
    ...frame.vectors.map((vector, axis) => [...vector, frame.origin[axis]].join(' ')),
    'ITEM: ATOMS id type' + (chemical ? ' element' : '') + ' x y z',
    ...frame.ids.map((id, i) => [preserveIds ? id : i + 1, species.indexOf(frame.species[i]) + 1, ...(chemical ? [frame.species[i]] : []), ...frame.positions.slice(i * 3, i * 3 + 3)].join(' ')),
  ];
  return rows.join('\n') + '\n';
}
export function timelineProperty(frame: MdFrame, property: string) {
  if (property === 'Atom count') return frame.ids.length;
  if (property === 'Cell volume') {
    const [a, b, c] = frame.vectors;
    return Math.abs(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]));
  }
  const values = frame.properties[property]?.filter(Number.isFinite);
  return values?.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
export function downloadMdFile(name: string, data: BlobPart, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.hidden = true;
  document.body.appendChild(link); link.click(); link.remove();
  // Keep large scene exports available long enough for the browser to consume them.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error('Device storage did not respond. Files can still be opened for this session.'));
    }, 8000);
    const request = indexedDB.open('phynite-md-studio', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('trajectories')) {
        request.result.createObjectStore('trajectories', { keyPath: 'id' });
      }
      if (!request.result.objectStoreNames.contains('sources')) {
        request.result.createObjectStore('sources', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => { clearTimeout(timeout); if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
    request.onerror = () => { clearTimeout(timeout); settled = true; reject(request.error); };
    request.onblocked = () => { clearTimeout(timeout); settled = true; reject(new Error('Device storage is blocked by another tab. Files can still be opened for this session.')); };
  });
}

type StoredMdTrajectoryRecord = Omit<MdTrajectoryRecord, 'file'> & {
  file?: Blob;
  sourceBytes?: ArrayBuffer;
  sourceType?: string;
};

type StoredMdTrajectorySource = {
  id: string;
  sourceBytes: ArrayBuffer;
  sourceType: string;
};

const knownMdSources = new Set<string>();

function serializeMdTrajectory(record: MdTrajectoryRecord): StoredMdTrajectoryRecord {
  const metadata: StoredMdTrajectoryRecord = { ...record };
  delete metadata.file;
  return metadata;
}

function hydrateMdTrajectory(record: StoredMdTrajectoryRecord, source?: StoredMdTrajectorySource): MdTrajectoryRecord | null {
  const { sourceBytes, sourceType, file: legacyFile, ...metadata } = record;
  const file = source?.sourceBytes instanceof ArrayBuffer
    ? new Blob([source.sourceBytes], { type: source.sourceType || 'application/octet-stream' })
    : sourceBytes instanceof ArrayBuffer
    ? new Blob([sourceBytes], { type: sourceType || 'application/octet-stream' })
    : legacyFile instanceof Blob
      ? legacyFile
      : null;
  return file ? { ...metadata, file } : null;
}

async function serializeMdSource(record: MdTrajectoryRecord): Promise<StoredMdTrajectorySource> {
  return {
    id: record.id,
    sourceBytes: await record.file.arrayBuffer(),
    sourceType: record.file.type,
  };
}

export async function listMdTrajectories(owner: string): Promise<MdTrajectoryRecord[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['trajectories', 'sources']);
    const recordRequest = tx.objectStore('trajectories').getAll();
    const sourceRequest = tx.objectStore('sources').getAll();
    tx.oncomplete = () => {
      const sources = new Map((sourceRequest.result as StoredMdTrajectorySource[]).map(source => [source.id, source]));
      sources.forEach((_source, id) => knownMdSources.add(id));
      const records = (recordRequest.result as StoredMdTrajectoryRecord[])
        .map(record => hydrateMdTrajectory(record, sources.get(record.id)))
        .filter((record): record is MdTrajectoryRecord => Boolean(record && (!record.owner || record.owner === owner)))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      database.close();
      resolve(records);
    };
    tx.onabort = () => { database.close(); reject(tx.error); };
    tx.onerror = () => { database.close(); reject(tx.error); };
  });
}
export async function saveMdTrajectory(record: MdTrajectoryRecord) {
  const stored = serializeMdTrajectory(record);
  const source = knownMdSources.has(record.id) ? null : await serializeMdSource(record);
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['trajectories', 'sources'], 'readwrite');
    tx.objectStore('trajectories').put(stored);
    if (source) tx.objectStore('sources').put(source);
    tx.oncomplete = () => {
      if (source) knownMdSources.add(record.id);
      database.close();
      resolve();
    };
    tx.onabort = () => { database.close(); reject(tx.error); };
    tx.onerror = () => { database.close(); reject(tx.error); };
  });
}
export async function saveMdTrajectories(records: MdTrajectoryRecord[]) {
  if (!records.length) return;
  const storedRecords = records.map(serializeMdTrajectory);
  const missingSources = records.filter(record => !knownMdSources.has(record.id));
  const storedSources = await Promise.all(missingSources.map(serializeMdSource));
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['trajectories', 'sources'], 'readwrite');
    const store = tx.objectStore('trajectories');
    storedRecords.forEach(record => store.put(record));
    const sourceStore = tx.objectStore('sources');
    storedSources.forEach(source => sourceStore.put(source));
    tx.oncomplete = () => {
      missingSources.forEach(record => knownMdSources.add(record.id));
      database.close();
      resolve();
    };
    tx.onabort = () => { database.close(); reject(tx.error); };
    tx.onerror = () => { database.close(); reject(tx.error); };
  });
}
export async function removeMdTrajectory(owner: string, id: string) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction(['trajectories', 'sources'], 'readwrite'), store = tx.objectStore('trajectories');
    const read = store.get(id);
    read.onsuccess = () => {
      if (!read.result?.owner || read.result?.owner === owner) {
        store.delete(id);
        tx.objectStore('sources').delete(id);
      }
    };
    read.onerror = () => { database.close(); reject(read.error); };
    tx.oncomplete = () => { knownMdSources.delete(id); database.close(); resolve(); };
    tx.onabort = () => { database.close(); reject(tx.error); };
    tx.onerror = () => { database.close(); reject(tx.error); };
  });
}
export type MdPipelineHistory = { past: MdSettings[]; present: MdSettings; future: MdSettings[] };
