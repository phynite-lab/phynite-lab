import type { CustomAtom } from '../components/CrystalViewer.tsx';
import { cellVectorsFromLattice, latticeFromCellVectors, type CellVectors } from './crystal-cell.ts';
import type { CrystalDatabaseMaterial } from './crystal-database.ts';
import { crystalDigest } from './crystal-database-options.ts';
import { supercellStructure } from './workflow-geometry.ts';
import { orderedStructureIssue } from './structure-occupancy.ts';

export type CrystalCellOptions = { cell: 'source' | 'primitive' | 'conventional'; repeat: [number, number, number]; symprec: number };
export type StandardizedCrystal = { vectors: CellVectors; sites: Array<Pick<CustomAtom, 'species' | 'x' | 'y' | 'z'>>; version: string; provenance: Record<string, unknown> };
export async function prepareCrystalCell(material: CrystalDatabaseMaterial, options: CrystalCellOptions, standardize?: (payload: Record<string, unknown>) => Promise<StandardizedCrystal>): Promise<CrystalDatabaseMaterial> {
  if (!['source', 'primitive', 'conventional'].includes(options.cell) || options.repeat.length !== 3 || options.repeat.some(value => !Number.isSafeInteger(value) || value < 1 || value > 16)) throw new Error('Choose a cell and integer repeats from 1 to 16 on each axis.');
  if (options.cell === 'source' && options.repeat.every(value => value === 1)) return material;
  let atoms = material.atoms, lattice = material.lattice;
  const transforms = [...(material.geometryTransforms ?? [])];
  if (options.cell !== 'source') {
    const issue = orderedStructureIssue(atoms);
    if (issue) throw new Error(issue);
    if (lattice.periodic?.some(value => !value)) throw new Error('Primitive/conventional conversion requires a fully periodic source. Use its source cell or a supercell.');
    if (material.magneticOrdering && !['NM', 'non-magnetic'].includes(material.magneticOrdering)) throw new Error('This source reports magnetic ordering without per-site magnetic symmetry. Keep the source cell or use a supercell.');
    if (!Number.isFinite(options.symprec) || options.symprec < 1e-6 || options.symprec > 0.1) throw new Error('Use a symmetry tolerance between 0.000001 and 0.1 Å.');
    if (!standardize) throw new Error('Primitive and conventional cell conversion needs the local DFT runtime.');
    const before = await crystalDigest(JSON.stringify({ lattice, atoms }));
    const converted = await standardize({ atoms: atoms.map(({ species, x, y, z }) => ({ species, x, y, z })), vectors: cellVectorsFromLattice(lattice), periodic: lattice.periodic ?? [true, true, true], cell: options.cell, symprec: options.symprec });
    lattice = { ...latticeFromCellVectors(converted.vectors), periodic: [true, true, true] };
    atoms = converted.sites.map((site, index) => ({ ...site, id: `${material.materialId}-${options.cell}-${index + 1}`, occupancy: 1, siteSpecies: [{ element: site.species, species: site.species, occupancy: 1 }] }));
    transforms.push({ ...converted.provenance, sourceStructureSha256: before, structureSha256: await crystalDigest(JSON.stringify({ lattice, atoms })) });
  }
  if (options.repeat.some(value => value !== 1)) {
    if (atoms.length * options.repeat.reduce((product, value) => product * value, 1) > 5000) throw new Error('Choose a supercell with at most 5,000 sites for database import.');
    const [a, b, c] = options.repeat, matrix: CellVectors = [[a, 0, 0], [0, b, 0], [0, 0, c]];
    const before = await crystalDigest(JSON.stringify({ lattice, atoms }));
    const result = supercellStructure({ atoms, cellVectors: cellVectorsFromLattice(lattice), periodic: lattice.periodic }, matrix);
    atoms = result.atoms; lattice = { ...latticeFromCellVectors(result.cellVectors), periodic: result.periodic };
    transforms.push({ ...result.provenance, sourceStructureSha256: before, structureSha256: await crystalDigest(JSON.stringify({ lattice, atoms })) });
  }
  return { ...material, atoms, lattice, numSites: atoms.length, geometryTransforms: transforms,
    warnings: [...material.warnings, ...(options.cell !== 'source' ? [`${options.cell} cell from spglib at ${options.symprec} Å tolerance; source geometry and its checksum are retained separately.`] : [])] };
}
