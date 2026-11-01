export type CellVector = [number, number, number];
export type CellVectors = [CellVector, CellVector, CellVector];
export type CellMetric = 'a' | 'b' | 'c' | 'alpha' | 'beta' | 'gamma';
export type LatticeParameters = Record<CellMetric, number> & {
  vectors?: CellVectors;
  periodic?: [boolean, boolean, boolean];
};

const dot = (a: CellVector, b: CellVector) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const cross = (a: CellVector, b: CellVector): CellVector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v: CellVector) => Math.hypot(...v);
const scale = (v: CellVector, value: number) => v.map((n) => n * value) as CellVector;
export const cellVolume = (vectors: CellVectors) => dot(vectors[0], cross(vectors[1], vectors[2]));

export function validateCell(vectors: CellVectors) {
  if (vectors.length !== 3 || vectors.some((v) => v.length !== 3 || !v.every(Number.isFinite) || norm(v) <= 0)) throw new Error('Cell vectors must contain finite, nonzero lengths.');
  const relativeVolume = Math.abs(cellVolume(vectors)) / vectors.reduce((product, v) => product * norm(v), 1);
  if (!Number.isFinite(relativeVolume) || relativeVolume < 1e-8) throw new Error('Cell vectors must span a nonzero volume; the cell is singular or nearly coplanar.');
  return vectors;
}

export function latticeFromCellVectors(vectors: CellVectors): LatticeParameters {
  validateCell(vectors);
  const [a, b, c] = vectors;
  const angle = (u: CellVector, v: CellVector) => Math.acos(Math.max(-1, Math.min(1, dot(u, v) / norm(u) / norm(v)))) * 180 / Math.PI;
  return { a: norm(a), b: norm(b), c: norm(c), alpha: angle(b, c), beta: angle(a, c), gamma: angle(a, b), vectors: vectors.map((v) => [...v]) as CellVectors };
}

export function cellVectorsFromLattice(lattice: LatticeParameters): CellVectors {
  if (![lattice.a, lattice.b, lattice.c].every((v) => Number.isFinite(v) && v > 0) || ![lattice.alpha, lattice.beta, lattice.gamma].every((v) => Number.isFinite(v) && v > 0 && v < 180)) throw new Error('Cell lengths must be positive and angles must lie between 0 and 180 degrees.');
  if (lattice.vectors) return validateCell(lattice.vectors);
  const [alpha, beta, gamma] = [lattice.alpha, lattice.beta, lattice.gamma].map((v) => v * Math.PI / 180);
  const cx = lattice.c * Math.cos(beta);
  const cy = lattice.c * (Math.cos(alpha) - Math.cos(beta) * Math.cos(gamma)) / Math.sin(gamma);
  const cz2 = lattice.c ** 2 - cx ** 2 - cy ** 2;
  if (cz2 <= 0) throw new Error('These cell angles do not define a physical three-dimensional cell.');
  return validateCell([[lattice.a, 0, 0], [lattice.b * Math.cos(gamma), lattice.b * Math.sin(gamma), 0], [cx, cy, Math.sqrt(cz2)]]);
}

export function cartesianToFractionalWithVectors(position: CellVector, vectors: CellVectors): CellVector {
  validateCell(vectors);
  const [a, b, c] = vectors;
  const volume = cellVolume(vectors);
  return [dot(position, cross(b, c)) / volume, dot(position, cross(c, a)) / volume, dot(position, cross(a, b)) / volume];
}

export function fractionalVectorToCartesian(position: CellVector, vectors: CellVectors): CellVector {
  return [0, 1, 2].map((axis) => position.reduce((sum, value, i) => sum + value * vectors[i][axis], 0)) as CellVector;
}

export function changeCellMetric(lattice: LatticeParameters, key: CellMetric, value: number): LatticeParameters {
  const [a, b, c] = cellVectorsFromLattice(lattice);
  const e1 = scale(a, 1 / norm(a));
  const perpendicular = b.map((v, axis) => v - dot(b, e1) * e1[axis]) as CellVector;
  const e2 = scale(perpendicular, 1 / norm(perpendicular));
  const e3 = scale(cross(e1, e2), Math.sign(dot(c, cross(e1, e2))));
  const canonical = cellVectorsFromLattice({ ...lattice, vectors: undefined, [key]: value });
  const vectors = canonical.map((v) => fractionalVectorToCartesian(v, [e1, e2, e3])) as CellVectors;
  return { ...latticeFromCellVectors(vectors), periodic: lattice.periodic };
}

export function addCellVacuum<T extends { x: number; y: number; z: number }>(atoms: T[], lattice: LatticeParameters, thickness: number) {
  if (!Number.isFinite(thickness) || thickness <= 0) throw new Error('Vacuum thickness must be a finite positive number.');
  const vectors = cellVectorsFromLattice(lattice);
  const normal = cross(vectors[0], vectors[1]);
  const direction = scale(normal, Math.sign(dot(normal, vectors[2])) / norm(normal));
  const nextVectors: CellVectors = [vectors[0], vectors[1], vectors[2].map((v, axis) => v + thickness * direction[axis]) as CellVector];
  const nextAtoms = atoms.map((atom) => {
    const cartesian = fractionalVectorToCartesian([atom.x, atom.y, atom.z], vectors).map((v, axis) => v + thickness * direction[axis] / 2) as CellVector;
    const [x, y, z] = cartesianToFractionalWithVectors(cartesian, nextVectors);
    return { ...atom, x, y, z };
  });
  return { atoms: nextAtoms, lattice: { ...latticeFromCellVectors(nextVectors), periodic: lattice.periodic } };
}
