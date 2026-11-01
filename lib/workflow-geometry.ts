import { cartesianToFractionalWithVectors, fractionalVectorToCartesian, cellVolume, validateCell, type CellVector, type CellVectors } from './crystal-cell.ts';

export type GeometryOperation = { kind: 'supercell'; matrix: CellVectors } | { kind: 'surface_slab'; miller: CellVector; layers: number; vacuumAngstrom: number; termination: number };
export type GeometryAtom = { id?: string; species: string; x: number; y: number; z: number };
export type GeometryStructure<T extends GeometryAtom = GeometryAtom> = { atoms: T[]; cellVectors: CellVectors; periodic?: [boolean, boolean, boolean] };
const mod = (x: number, base = 1) => ((x % base) + base) % base;
const cross = (a: CellVector, b: CellVector): CellVector => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a: number[], b: number[]) => a.reduce((s, n, i) => s+n*b[i], 0);

export function supercellStructure<T extends GeometryAtom>(source: GeometryStructure<T>, matrix: CellVectors) {
  validateCell(source.cellVectors);
  if (matrix.length !== 3 || matrix.some(row => row.length !== 3 || row.some(x => !Number.isSafeInteger(x) || Math.abs(x) > 512))) throw new Error('Supercell requires a 3×3 integer matrix with entries between −512 and 512.');
  const determinant = Math.round(cellVolume(matrix)), size = Math.abs(determinant);
  if (determinant <= 0 || size > 4096 || !source.atoms.length || source.atoms.length*size > 100000) throw new Error('Use a right-handed nonsingular supercell matrix producing at most 4096 cells and 100,000 atoms.');
  if (source.periodic?.some(p => !p) && matrix.some((row, i) => row.some((n, j) => i !== j && n !== 0))) throw new Error('Off-diagonal supercells require a fully periodic source.');
  const inverseNumerator = [0, 1, 2].map(i => cartesianToFractionalWithVectors([+(i===0), +(i===1), +(i===2)], matrix).map(x => Math.round(x*determinant)));
  const key = (n: CellVector) => [0, 1, 2].map(j => mod(n.reduce((sum, value, i) => sum+value*inverseNumerator[i][j], 0), size)).join(',');
  const translations: CellVector[] = [[0, 0, 0]], seen = new Set([key(translations[0])]);
  for (let i = 0; i < translations.length && translations.length < size; i++) for (let axis = 0; axis < 3; axis++) {
    const n = [...translations[i]] as CellVector; n[axis]++;
    const identity = key(n); if (!seen.has(identity)) { seen.add(identity); translations.push(n); }
  }
  if (translations.length !== size) throw new Error('Could not construct every supercell lattice coset.');
  const cellVectors = matrix.map(row => fractionalVectorToCartesian(row, source.cellVectors)) as CellVectors;
  const atoms: T[] = [], mapping: Array<{ sourceIndex: number; translation: CellVector }> = [];
  translations.forEach((translation, image) => source.atoms.forEach((atom, sourceIndex) => {
    if (![atom.x, atom.y, atom.z].every(Number.isFinite)) throw new Error('Geometry source contains non-finite positions.');
    const f = [atom.x, atom.y, atom.z].map((x, i) => (source.periodic?.[i] === false ? x : mod(x))+translation[i]) as CellVector;
    const [x, y, z] = cartesianToFractionalWithVectors(f, matrix).map((value, axis) => { if (source.periodic?.[axis] === false) return value; const v = mod(value); return v < 1e-10 || 1-v < 1e-10 ? 0 : v; });
    atoms.push({ ...atom, id: `${atom.id ?? sourceIndex}@cell:${image}`, x, y, z }); mapping.push({ sourceIndex, translation });
  }));
  return { atoms, cellVectors, periodic: source.periodic ?? [true, true, true] as [boolean, boolean, boolean], mapping,
    provenance: { operation: 'supercell', matrix, multiplicity: size, coordinateUnit: 'fractional', cellUnit: 'angstrom' } };
}

function egcd(a: number, b: number): [number, number, number] {
  if (!b) return [Math.abs(a), Math.sign(a), 0];
  const [g, x, y] = egcd(b, a%b); return [g, y, x-Math.trunc(a/b)*y];
}
export function slabOrientation(miller: CellVector): CellVectors {
  if (miller.length !== 3 || miller.some(n => !Number.isInteger(n) || Math.abs(n) > 12) || miller.every(n => n === 0)) throw new Error('Use nonzero integer Miller indices between −12 and 12.');
  const gcd = egcd(egcd(miller[0], miller[1])[0], miller[2])[0];
  const [h, k, l] = miller.map(n => n/gcd);
  if (!h && !k) return [[1, 0, 0], [0, l, 0], [0, 0, l]];
  const [g, x, y] = egcd(h, k), [, a, b] = egcd(g, l);
  return [[k/g, -h/g, 0], [l*x, l*y, -g], [a*x, a*y, b]];
}

export function surfaceSlabStructure<T extends GeometryAtom>(source: GeometryStructure<T>, params: Extract<GeometryOperation, { kind: 'surface_slab' }>) {
  if (source.periodic?.some(p => !p)) throw new Error('A Miller slab requires a fully periodic bulk source.');
  if (!Number.isInteger(params.layers) || params.layers < 1 || params.layers > 256 || !Number.isFinite(params.vacuumAngstrom) || params.vacuumAngstrom <= 0 || params.vacuumAngstrom > 1000) throw new Error('Use 1–256 atomic layers and positive vacuum up to 1000 Å.');
  const oriented = supercellStructure(source, slabOrientation(params.miller));
  const levels = [...new Set(oriented.atoms.map(atom => Math.round(atom.z*1e8)/1e8))].sort((a, b) => a-b);
  if (!Number.isInteger(params.termination) || params.termination < 0 || params.termination >= levels.length) throw new Error(`Choose a termination index from 0 to ${levels.length-1}.`);
  const [a, b, c] = oriented.cellVectors;
  const perpendicular = cross(a, b), sign = Math.sign(dot(perpendicular, c));
  const normal = perpendicular.map(x => sign*x/Math.hypot(...perpendicular)) as CellVector;
  const spacing = dot(c, normal), start = levels[params.termination]*spacing;
  const lastIndex = params.termination+params.layers-1;
  const thickness = (Math.floor(lastIndex/levels.length)+levels[lastIndex%levels.length])*spacing-start;
  const cellVectors: CellVectors = [a, b, normal.map(x => x*(thickness+params.vacuumAngstrom)) as CellVector];
  const atoms: T[] = [], mapping: Array<{ sourceIndex: number; layer: number }> = [];
  for (let layer = 0; layer < params.layers; layer++) {
    const index = params.termination+layer, period = Math.floor(index/levels.length), level = levels[index%levels.length];
    oriented.atoms.forEach((atom, sourceIndex) => {
      if (Math.abs(atom.z-level) > 1e-7) return;
      if (atoms.length >= 100000) throw new Error('Slab exceeds the 100,000 atom geometry limit.');
      const position = fractionalVectorToCartesian([atom.x, atom.y, atom.z+period], oriented.cellVectors).map((x, axis) => x+normal[axis]*(params.vacuumAngstrom/2-start)) as CellVector;
      const f = cartesianToFractionalWithVectors(position, cellVectors);
      atoms.push({ ...atom, id: `${atom.id}@layer:${layer}`, x: mod(f[0]), y: mod(f[1]), z: f[2] }); mapping.push({ sourceIndex: oriented.mapping[sourceIndex].sourceIndex, layer });
    });
  }
  return { atoms, cellVectors, periodic: [true, true, false] as [boolean, boolean, boolean], mapping,
    provenance: { operation: 'surface_slab', ...params, orientation: slabOrientation(params.miller), distinctTerminations: levels.length, slabThicknessAngstrom: thickness, coordinateUnit: 'fractional', cellUnit: 'angstrom' } };
}
export function applyWorkflowGeometry<T extends GeometryAtom>(source: GeometryStructure<T>, operation: GeometryOperation) {
  return operation.kind === 'supercell' ? supercellStructure(source, operation.matrix) : surfaceSlabStructure(source, operation);
}
