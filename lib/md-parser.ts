import { fractionalVectorToCartesian, validateCell, type CellVector, type CellVectors } from './crystal-cell.ts';
import { parseStructureText, cellVectorsFromLattice } from './structure-parsers.ts';
import type { MdFrame, MdIndex } from './md-types.ts';
import { readMdRunSnapshot } from './md-run-snapshot.ts';

export type MdParseResult = { frames: MdFrame[]; index: MdIndex; warnings: string[]; loadFrame?: (index: number) => Promise<MdFrame> };
export const MD_MAX_ATOMS = 1_000_000;
export const MD_MAX_COORDINATES = 12_000_000;
const number = (value: string | undefined, context: string) => {
  if (value === undefined || !value.trim() || !Number.isFinite(Number(value))) throw new Error(context + ': expected a finite number.');
  return Number(value);
};
const countOf = (value: string) => {
  const count = number(value, 'Atom count');
  if (!Number.isInteger(count) || count < 1 || count > MD_MAX_ATOMS) throw new Error('Use 1–1,000,000 atoms per frame. Large simulations require a matching personal compute grant.');
  return count;
};

export function boundsForPositions(positions: number[]) {
  const min: CellVector = [Infinity, Infinity, Infinity], max: CellVector = [-Infinity, -Infinity, -Infinity];
  positions.forEach((v, i) => { min[i % 3] = Math.min(min[i % 3], v); max[i % 3] = Math.max(max[i % 3], v); });
  if (!positions.length) return { min: [0, 0, 0] as CellVector, max: [1, 1, 1] as CellVector };
  return { min, max };
}
function finiteCell(positions: number[]) {
  const { min, max } = boundsForPositions(positions);
  const lengths = max.map((v, i) => Math.max(4, v - min[i] + 4));
  return { vectors: [[lengths[0], 0, 0], [0, lengths[1], 0], [0, 0, lengths[2]]] as CellVectors, origin: min.map(v => v - 2) as CellVector };
}
function box(header: string, rows: string[]) {
  const flags = header.split(/\s+/).filter(v => /^[pfsm]{2}$/.test(v));
  const periodic = flags.length === 3 ? flags.map(v => v === 'pp') as [boolean, boolean, boolean] : [false, false, false] as [boolean, boolean, boolean];
  const values = rows.map(row => row.trim().split(/\s+/).map(v => number(v, 'Box bounds')));
  if (values.length !== 3) throw new Error('Incomplete simulation cell.');
  let vectors: CellVectors, origin: CellVector;
  if (header.includes('abc origin')) {
    if (values.some(row => row.length !== 4)) throw new Error('General triclinic bounds need a vector and origin per row.');
    vectors = values.map(row => row.slice(0, 3)) as CellVectors;
    origin = values.map(row => row[3]) as CellVector;
  } else if (header.includes('xy xz yz')) {
    if (values.some(row => row.length !== 3)) throw new Error('Triclinic bounds need three tilt factors.');
    const [[xb0, xb1, xy], [yb0, yb1, xz], [z0, z1, yz]] = values;
    const x0 = xb0 - Math.min(0, xy, xz, xy + xz), x1 = xb1 - Math.max(0, xy, xz, xy + xz);
    const y0 = yb0 - Math.min(0, yz), y1 = yb1 - Math.max(0, yz);
    vectors = [[x1 - x0, 0, 0], [xy, y1 - y0, 0], [xz, yz, z1 - z0]];
    origin = [x0, y0, z0];
  } else {
    if (values.some(row => row.length !== 2)) throw new Error('Orthogonal bounds need lower and upper limits.');
    origin = values.map(row => row[0]) as CellVector;
    vectors = [[values[0][1] - origin[0], 0, 0], [0, values[1][1] - origin[1], 0], [0, 0, values[2][1] - origin[2]]];
  }
  validateCell(vectors);
  return { vectors, origin, periodic };
}
function lammps(text: string) {
  const lines = text.replaceAll('\r', '').split('\n'), frames: MdFrame[] = [], warnings: string[] = [];
  let cursor = 0, total = 0;
  let unitStyle = '';
  // LAMMPS units: geometry -> Å, native TIME -> ps. Reduced LJ needs an explicit
  // sigma/time scale and cannot be assigned physical dimensions from the dump.
  const unitFactors: Record<string, { length: number; time: number }> = {
    metal: { length: 1, time: 1 }, real: { length: 1, time: .001 },
    nano: { length: 10, time: 1000 }, micro: { length: 10000, time: 1e6 },
    electron: { length: .529177210903, time: .001 },
    si: { length: 1e10, time: 1e12 }, cgs: { length: 1e8, time: 1e12 },
  };
  const next = () => { const row = lines[cursor++]; if (row === undefined) throw new Error('Trajectory ends inside a frame.'); return row; };
  while (cursor < lines.length) {
    while (cursor < lines.length && !lines[cursor].trim()) cursor++;
    if (cursor === lines.length) break;
    if (lines[cursor].trim() === 'ITEM: UNITS') {
      next();
      const declaredUnits = next().trim();
      if (!unitFactors[declaredUnits]) throw new Error(`LAMMPS units ${declaredUnits || '(empty)'} cannot be converted to Å and ps. Export physical units; reduced LJ requires explicit length and time scales.`);
      if (unitStyle && unitStyle !== declaredUnits) throw new Error('LAMMPS unit style changes between frames. Split trajectories with different units.');
      unitStyle = declaredUnits;
      while (cursor < lines.length && !lines[cursor].trim()) cursor++;
    }
    let nativeTime: number | null = null;
    if (lines[cursor]?.trim() === 'ITEM: TIME') {
      next();
      nativeTime = number(next(), 'Time');
    }
    if (next().trim() !== 'ITEM: TIMESTEP') throw new Error('Expected ITEM: TIMESTEP.');
    const timestep = number(next(), 'Timestep');
    if (lines[cursor]?.trim() === 'ITEM: TIME') { next(); nativeTime = number(next(), 'Time'); }
    if (next().trim() !== 'ITEM: NUMBER OF ATOMS') throw new Error('Missing atom count.');
    const count = countOf(next());
    total += count * 3;
    if (total > MD_MAX_COORDINATES) throw new Error('Trajectory exceeds the browser memory limit. Split it into smaller files.');
    const header = next();
    if (!header.startsWith('ITEM: BOX BOUNDS')) throw new Error('Missing simulation cell.');
    const cell = box(header, [next(), next(), next()]);
    const factor = unitFactors[unitStyle]?.length ?? 1;
    cell.vectors = cell.vectors.map(vector => vector.map(value => value * factor)) as CellVectors;
    cell.origin = cell.origin.map(value => value * factor) as CellVector;
    const atomHeader = next();
    if (!atomHeader.startsWith('ITEM: ATOMS ')) throw new Error('Missing atom columns.');
    const columns = atomHeader.slice(12).trim().split(/\s+/);
    const modes = [['x', 'y', 'z'], ['xu', 'yu', 'zu'], ['xs', 'ys', 'zs'], ['xsu', 'ysu', 'zsu']];
    const mode = modes.find(names => names.every(name => columns.includes(name)));
    if (!mode) throw new Error('Provide x/y/z, xu/yu/zu, xs/ys/zs, or xsu/ysu/zsu coordinates.');
    const coords = mode.map(name => columns.indexOf(name)), scaled = mode[0].includes('s');
    const idIndex = columns.indexOf('id'), typeIndex = columns.indexOf('type');
    const elementIndex = columns.findIndex(name => ['element', 'species', 'typelabel'].includes(name));
    const properties: Record<string, number[]> = Object.create(null);
    columns.forEach(name => { if (!['element', 'species', 'typelabel', 'id'].includes(name)) properties[name] = []; });
    const ids: string[] = [], species: string[] = [], positions: number[] = [];
    for (let atom = 0; atom < count; atom++) {
      const row = next().trim().split(/\s+/);
      if (row.length !== columns.length) throw new Error('Frame ' + (frames.length + 1) + ', atom ' + (atom + 1) + ': column count mismatch.');
      ids.push(idIndex >= 0 ? row[idIndex] : String(atom + 1));
      species.push(elementIndex >= 0 ? row[elementIndex] : typeIndex >= 0 ? row[typeIndex] : 'X');
      const p = coords.map(i => number(row[i], 'Position')) as CellVector;
      positions.push(...(scaled ? fractionalVectorToCartesian(p, cell.vectors).map((v, i) => v + cell.origin[i]) : p.map(value => value * factor)));
      Object.keys(properties).forEach(name => {
        const value = row[columns.indexOf(name)];
        const geometryColumn = /^(x|y|z|xu|yu|zu)$/.test(name);
        properties[name].push(Number.isFinite(Number(value)) ? Number(value) * (geometryColumn ? factor : 1) : NaN);
      });
    }
    if (new Set(ids).size !== count) throw new Error('Duplicate particle identifiers in frame ' + (frames.length + 1) + '.');
    if (idIndex < 0 && !warnings.length) warnings.push('No particle IDs: tracking between frames assumes a stable row order.');
    if (nativeTime !== null && !unitStyle && !warnings.includes('LAMMPS TIME has unknown units; physical time is unavailable. Declare ITEM: UNITS to convert it.')) warnings.push('LAMMPS TIME has unknown units; physical time is unavailable. Declare ITEM: UNITS to convert it.');
    if (unitStyle && !warnings.some(warning => warning.startsWith('LAMMPS unit style:'))) warnings.push(`LAMMPS unit style: ${unitStyle}.`);
    if (!unitStyle && !warnings.includes('No LAMMPS unit declaration: geometry assumes Å. Verify the original units before analysis.')) warnings.push('No LAMMPS unit declaration: geometry assumes Å. Verify the original units before analysis.');
    if (unitStyle && factor !== 1 && !warnings.some(warning => warning.startsWith('Converted geometry'))) warnings.push('Converted geometry to Å and known TIME to ps; other particle properties retain source units.');
    frames.push({ index: frames.length, timestep, time: nativeTime !== null && unitStyle ? nativeTime * unitFactors[unitStyle].time : null, nativeTime, sourceUnits: unitStyle || undefined, coordinateMode: mode[0].includes('u') ? 'unwrapped' : 'wrapped', ids, species, positions, properties, ...cell, hasCell: true });
  }
  return { frames, warnings };
}
function xyz(text: string) {
  const lines = text.replaceAll('\r', '').split('\n'), frames: MdFrame[] = [];
  let cursor = 0, total = 0;
  while (cursor < lines.length) {
    while (cursor < lines.length && !lines[cursor].trim()) cursor++;
    if (cursor === lines.length) break;
    const count = countOf(lines[cursor++]);
    total += count * 3;
    if (total > MD_MAX_COORDINATES) throw new Error('Trajectory exceeds the browser memory limit. Split it into smaller files.');
    const comment = lines[cursor++];
    if (comment === undefined) throw new Error('Missing XYZ comment line.');
    const latticeText = comment.match(/Lattice\s*=\s*"([^"]+)"/i)?.[1];
    const pbcText = comment.match(/pbc\s*=\s*"([^"]+)"/i)?.[1]?.split(/\s+/);
    if (pbcText && (pbcText.length !== 3 || pbcText.some(v => !/^(T|F|true|false|1|0)$/i.test(v)))) throw new Error('pbc needs three boolean flags.');
    const periodic = (pbcText ? pbcText.map(v => /^(T|true|1)$/i.test(v)) : [Boolean(latticeText), Boolean(latticeText), Boolean(latticeText)]) as [boolean, boolean, boolean];
    const schema = (comment.match(/Properties\s*=\s*"?([^"\s]+)/i)?.[1] || 'species:S:1:pos:R:3').split(':');
    if (schema.length % 3) throw new Error('Invalid extXYZ Properties schema.');
    const fields: Array<{ name: string; type: string; size: number; offset: number }> = [];
    let offset = 0;
    for (let i = 0; i < schema.length; i += 3) {
      const size = number(schema[i + 2], 'Property size');
      if (!Number.isInteger(size) || size < 1 || size > 64) throw new Error('Invalid property width.');
      fields.push({ name: schema[i], type: schema[i + 1], size, offset }); offset += size;
    }
    const pos = fields.find(f => ['pos', 'position'].includes(f.name.toLowerCase()) && f.size === 3);
    const speciesField = fields.find(f => ['species', 'element'].includes(f.name.toLowerCase()));
    const idField = fields.find(f => ['id', 'identifier'].includes(f.name.toLowerCase()));
    if (!pos || !speciesField) throw new Error('extXYZ requires species and pos fields.');
    const properties: Record<string, number[]> = Object.create(null);
    const numeric = fields.filter(f => f !== pos && f !== speciesField && ['R', 'I', 'L'].includes(f.type));
    numeric.forEach(f => { for (let c = 0; c < f.size; c++) properties[f.size === 1 ? f.name : f.name + '.' + (['X', 'Y', 'Z'][c] || c)] = []; });
    const ids: string[] = [], species: string[] = [], positions: number[] = [];
    for (let i = 0; i < count; i++) {
      const row = (lines[cursor++] || '').trim().split(/\s+/);
      if (row.length < offset) throw new Error('Incomplete XYZ frame ' + (frames.length + 1) + '.');
      ids.push(idField ? row[idField.offset] : String(i + 1)); species.push(row[speciesField.offset]);
      positions.push(...row.slice(pos.offset, pos.offset + 3).map(v => number(v, 'XYZ position')));
      numeric.forEach(f => { for (let c = 0; c < f.size; c++) properties[f.size === 1 ? f.name : f.name + '.' + (['X', 'Y', 'Z'][c] || c)].push(f.type === 'L' ? Number(/^(T|true|1)$/i.test(row[f.offset + c])) : number(row[f.offset + c], f.name)); });
    }
    if (new Set(ids).size !== count) throw new Error('Particle IDs must be unique within an XYZ frame.');
    if (!latticeText && periodic.some(Boolean)) throw new Error('Periodic XYZ data requires Lattice vectors.');
    let cell = finiteCell(positions);
    if (latticeText) {
      const values = latticeText.trim().split(/\s+/).map(v => number(v, 'Lattice'));
      if (values.length !== 9) throw new Error('Lattice needs nine values.');
      const vectors = [values.slice(0, 3), values.slice(3, 6), values.slice(6, 9)] as CellVectors;
      validateCell(vectors); cell = { vectors, origin: [0, 0, 0] };
    }
    frames.push({ index: frames.length, timestep: null, time: null, ids, species, positions, properties, ...cell, periodic, hasCell: Boolean(latticeText) });
  }
  return { frames, warnings: [] as string[] };
}
export function parseMdText(text: string, fileName = 'trajectory'): MdParseResult {
  if (!text.trim()) throw new Error('Trajectory file is empty.');
  let format: MdIndex['format'];
  let result: { frames: MdFrame[]; warnings: string[] };
  if (/^\s*\{/.test(text) && fileName.endsWith('.phynite-md.json')) { format = 'phynite-frame'; result = { frames: [readMdRunSnapshot(text, MD_MAX_ATOMS).frame], warnings: [] }; }
  else if (/^\s*ITEM:\s*TIMESTEP/m.test(text)) { format = 'lammps'; result = lammps(text); }
  else if (/^\s*\d+\s*\r?\n/.test(text)) { format = 'xyz'; result = xyz(text); }
  else {
    format = 'structure';
    try {
      const structure = parseStructureText(text, fileName);
      const warnings: string[] = [];
      if (structure.atoms.some(atom => (atom.occupancy ?? 1) !== 1 || (atom.siteSpecies?.length ?? 0) > 1)) {
        warnings.push('Structure has partial or disordered site occupancies. Fully occupied, ordered sites are recommended for MD dynamics.');
      }
      const vectors = cellVectorsFromLattice(structure.lattice);
      result = {
        frames: [{
          index: 0,
          timestep: null,
          time: null,
          ids: structure.atoms.map(a => a.id),
          species: structure.atoms.map(a => a.species),
          positions: structure.atoms.flatMap(a => fractionalVectorToCartesian([a.x, a.y, a.z], vectors)),
          properties: {},
          vectors,
          origin: [0, 0, 0],
          periodic: structure.lattice.periodic ?? [true, true, true],
          hasCell: true,
        }],
        warnings,
      };
    } catch (error) { throw new Error('No readable trajectory or structure. ' + (error instanceof Error ? error.message : 'Check the file format.')); }
  }
  if (!result.frames.length) throw new Error('No readable trajectory frames.');
  return { ...result, index: { format, name: fileName, offsets: result.frames.map((_, i) => i), warnings: result.warnings } };
}
export function frameTimePs(frame: MdFrame, _frameIndex: number, timeStepPs: number | null): number | null {
  if (frame.time !== null) return frame.time;
  return frame.timestep !== null && timeStepPs !== null ? frame.timestep * timeStepPs : null;
}
