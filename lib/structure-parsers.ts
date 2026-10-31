import { orderedStructureIssue } from './structure-occupancy.ts';
import type { CustomAtom, LatticeParameters } from '@/components/CrystalViewer';
import { latticeFromCellVectors, cellVectorsFromLattice, cartesianToFractionalWithVectors, cellVolume } from './crystal-cell.ts';
export { latticeFromCellVectors, cellVectorsFromLattice } from './crystal-cell.ts';
const vectorsToLattice = latticeFromCellVectors;

type Vector = [number, number, number];

export type ParsedStructure = {
  name: string;
  atoms: CustomAtom[];
  lattice: LatticeParameters;
};

const atomicSymbols = (
  'X H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu ' +
  'Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
).split(' ');

function cleanNumber(value: string | undefined, fallback = Number.NaN) {
  if (!value) return fallback;
  const normalized = value.replace(/\([^)]*\)/g, '').replace(/[dD]([+-]?\d+)/, 'e$1').trim();
  const fraction = normalized.match(/^([+-]?[\d.]+)\s*\/\s*([+-]?[\d.]+)$/);
  const parsed = fraction
    ? Number.parseFloat(fraction[1]) / Number.parseFloat(fraction[2])
    : Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function elementSymbol(value: string) {
  if (/^\d+$/.test(value)) return atomicSymbols[Number(value)] ?? 'X';
  const match = value.match(/[A-Z][a-z]?/i);
  if (!match) return 'X';
  return match[0][0].toUpperCase() + match[0].slice(1).toLowerCase();
}

export function fractionalToCartesian(
  atom: Pick<CustomAtom, 'x' | 'y' | 'z'>,
  lattice: LatticeParameters,
): Vector {
  const [a, b, c] = cellVectorsFromLattice(lattice);
  return [
    atom.x * a[0] + atom.y * b[0] + atom.z * c[0],
    atom.x * a[1] + atom.y * b[1] + atom.z * c[1],
    atom.x * a[2] + atom.y * b[2] + atom.z * c[2],
  ];
}

export function cartesianToFractional(
  position: Vector,
  lattice: LatticeParameters,
): Vector {
  return cartesianToFractionalWithVectors(position, cellVectorsFromLattice(lattice));
}

function atom(id: string, species: string, position: Vector, siteLabel?: string): CustomAtom {
  const element = elementSymbol(species);
  const label = siteLabel?.trim() || (/^[A-Za-z]/.test(species.trim()) ? species.trim() : element);
  return { id, species: element, label, x: position[0], y: position[1], z: position[2] };
}

function parseXYZ(text: string, name: string): ParsedStructure {
  const lines = text.trimStart().split(/\r?\n/);
  const count = Number.parseInt(lines[0] ?? '', 10);
  if (!Number.isFinite(count) || count < 1) throw new Error('XYZ atom count is missing.');
  const comment = lines[1] ?? '';
  const rows = lines.slice(2, 2 + count).map((line) => line.trim().split(/\s+/));
  if (rows.length !== count || rows.some((row) => row.length < 4)) throw new Error('XYZ coordinates are incomplete.');
  const cartesian = rows.map((row) => [cleanNumber(row[1]), cleanNumber(row[2]), cleanNumber(row[3])] as Vector);
  const latticeMatch = comment.match(/Lattice\s*=\s*"([^"]+)"/i);
  let vectors: [Vector, Vector, Vector];
  let origin: Vector = [0, 0, 0];
  if (latticeMatch) {
    const values = latticeMatch[1].trim().split(/\s+/).map((value) => cleanNumber(value));
    if (values.length < 9) throw new Error('Extended XYZ lattice must contain nine numbers.');
    vectors = [values.slice(0, 3) as Vector, values.slice(3, 6) as Vector, values.slice(6, 9) as Vector];
  } else {
    const mins: Vector = [0, 1, 2].map((axis) => Math.min(...cartesian.map((item) => item[axis]))) as Vector;
    const maxs: Vector = [0, 1, 2].map((axis) => Math.max(...cartesian.map((item) => item[axis]))) as Vector;
    origin = mins.map((value) => value - 2) as Vector;
    const spans = maxs.map((value, axis) => Math.max(value - mins[axis] + 4, 4)) as Vector;
    vectors = [[spans[0], 0, 0], [0, spans[1], 0], [0, 0, spans[2]]];
  }
  const periodicText = comment.match(/pbc\s*=\s*"([^"]+)"/i)?.[1]?.trim().split(/\s+/);
  if (periodicText && (periodicText.length !== 3 || periodicText.some((v) => !/^(T|F|true|false|0|1)$/i.test(v)))) throw new Error('Extended XYZ pbc must contain three boolean flags.');
  const lattice: LatticeParameters = { ...vectorsToLattice(vectors), periodic: periodicText ? periodicText.map((v) => /^(T|true|1)$/i.test(v)) as [boolean, boolean, boolean] : latticeMatch ? [true, true, true] : [false, false, false] };
  const atoms = rows.map((row, index) => {
    const shifted = cartesian[index].map((value, axis) => value - origin[axis]) as Vector;
    return atom(`imported-atom-${index + 1}`, row[0], cartesianToFractionalWithVectors(shifted, vectors));
  });
  return { name, atoms, lattice };
}

function parsePOSCAR(text: string, fallbackName: string): ParsedStructure {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 8) throw new Error('POSCAR file is incomplete.');
  const name = lines[0] || fallbackName;
  const scaling = lines[1].split(/\s+/).map(Number);
  if (![1, 3].includes(scaling.length) || !scaling.every(Number.isFinite) || scaling.some((v) => v === 0) || (scaling.length === 3 && scaling.some((v) => v < 0))) throw new Error('POSCAR needs one nonzero scale or three positive Cartesian scale factors.');
  const rawVectors = [2, 3, 4].map((i) => lines[i].split(/\s+/).slice(0, 3).map(Number) as Vector) as [Vector, Vector, Vector];
  latticeFromCellVectors(rawVectors);
  const uniform = scaling[0] < 0 ? Math.cbrt(-scaling[0] / Math.abs(cellVolume(rawVectors))) : scaling[0];
  const factors = scaling.length === 3 ? scaling : [uniform, uniform, uniform];
  const vectors = rawVectors.map((v) => v.map((value, axis) => value * factors[axis]) as Vector) as [Vector, Vector, Vector];
  let species = lines[5].split(/\s+/);
  let countLine = 6;
  if (species.every((value) => /^\d+$/.test(value))) {
    countLine = 5;
    species = species.map((_, index) => `X${index + 1}`);
  }
  const counts = lines[countLine].split(/\s+/).map(Number);
  if (counts.length !== species.length || !counts.every((v) => Number.isSafeInteger(v) && v >= 0) || !counts.some((v) => v > 0)) throw new Error('POSCAR species counts must be nonnegative integers.');
  let coordinateLine = countLine + 1;
  if (/^s/i.test(lines[coordinateLine])) coordinateLine += 1;
  if (!/^[dck]/i.test(lines[coordinateLine])) throw new Error('POSCAR coordinate mode must be Direct or Cartesian.');
  const direct = /^d/i.test(lines[coordinateLine]);
  const total = counts.reduce((sum, value) => sum + value, 0);
  const coordinateRows = lines.slice(coordinateLine + 1, coordinateLine + 1 + total);
  if (coordinateRows.length < total) throw new Error('POSCAR atomic coordinates are incomplete.');
  const expandedSpecies = counts.flatMap((count, index) => Array.from({ length: count }, () => species[index] ?? `X${index + 1}`));
  const atoms = coordinateRows.map((row, index) => {
    const values = row.split(/\s+/).slice(0, 3).map((value) => cleanNumber(value)) as Vector;
    const fractional = direct ? values : cartesianToFractionalWithVectors(values.map((value, axis) => value * factors[axis]) as Vector, vectors);
    return atom(`imported-atom-${index + 1}`, expandedSpecies[index], fractional);
  });
  return { name, atoms, lattice: vectorsToLattice(vectors) };
}

function parseXSF(text: string, name: string): ParsedStructure {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const primitiveIndex = lines.findIndex((line) => line.toUpperCase().startsWith('PRIMVEC'));
  const coordinateIndex = lines.findIndex((line) => line.toUpperCase().startsWith('PRIMCOORD'));
  const finiteIndex = lines.findIndex((line) => /^ATOMS(?:\s|$)/i.test(line));
  if (finiteIndex >= 0 && coordinateIndex < 0) {
    const rows: string[][] = [];
    for (const line of lines.slice(finiteIndex + 1)) {
      if (!line || line.startsWith('#')) continue;
      const values = line.split(/\s+/);
      if (values.length < 4 || !values.slice(1, 4).every((v) => Number.isFinite(cleanNumber(v)))) break;
      rows.push(values);
    }
    const parsed = parseXYZ(`${rows.length}\n\n${rows.map((row) => row.slice(0, 4).join(' ')).join('\n')}`, name);
    parsed.atoms = parsed.atoms.map((atom, index) => ({ ...atom, ...(rows[index].length >= 7 ? { fx: cleanNumber(rows[index][4]), fy: cleanNumber(rows[index][5]), fz: cleanNumber(rows[index][6]) } : {}) }));
    return parsed;
  }
  if (primitiveIndex < 0 || coordinateIndex < 0) {
    throw new Error('XSF requires PRIMVEC and PRIMCOORD blocks.');
  }
  const vectors = lines.slice(primitiveIndex + 1, primitiveIndex + 4).map((line) =>
    line.split(/\s+/).slice(0, 3).map((value) => cleanNumber(value)) as Vector,
  ) as [Vector, Vector, Vector];
  const count = Number.parseInt(lines[coordinateIndex + 1]?.split(/\s+/)[0] ?? '', 10);
  if (!Number.isFinite(count) || count < 1) throw new Error('XSF atom count is missing.');
  const rows = lines.slice(coordinateIndex + 2, coordinateIndex + 2 + count);
  if (rows.length < count) throw new Error('XSF atomic coordinates are incomplete.');
  const atoms = rows.map((row, index) => {
    const values = row.split(/\s+/);
    const cartesian = values.slice(1, 4).map((value) => cleanNumber(value)) as Vector;
    return {
      ...atom(
      `imported-atom-${index + 1}`,
      values[0],
      cartesianToFractionalWithVectors(cartesian, vectors),
      ),
      ...(values.length >= 7 ? {
        fx: cleanNumber(values[4]),
        fy: cleanNumber(values[5]),
        fz: cleanNumber(values[6]),
      } : {}),
    };
  });
  const periodic: [boolean, boolean, boolean] = lines.some((line) => /^SLAB$/i.test(line)) ? [true, true, false] : lines.some((line) => /^POLYMER$/i.test(line)) ? [true, false, false] : [true, true, true];
  return { name, atoms, lattice: { ...vectorsToLattice(vectors), periodic } };
}

function parsePDB(text: string, fallbackName: string): ParsedStructure {
  const lines = text.split(/\r?\n/);
  const crystal = lines.find((line) => line.startsWith('CRYST1'));
  const rows = lines.filter((line) => line.startsWith('ATOM  ') || line.startsWith('HETATM'));
  if (!rows.length) throw new Error('No ATOM or HETATM records were found in the PDB file.');

  const cartesian = rows.map((line) => [
    cleanNumber(line.slice(30, 38)),
    cleanNumber(line.slice(38, 46)),
    cleanNumber(line.slice(46, 54)),
  ] as Vector);
  let origin: Vector = [0, 0, 0];
  let lattice: LatticeParameters;

  if (crystal) {
    lattice = {
      a: cleanNumber(crystal.slice(6, 15), 1),
      b: cleanNumber(crystal.slice(15, 24), 1),
      c: cleanNumber(crystal.slice(24, 33), 1),
      alpha: cleanNumber(crystal.slice(33, 40), 90),
      beta: cleanNumber(crystal.slice(40, 47), 90),
      gamma: cleanNumber(crystal.slice(47, 54), 90),
    };
  } else {
    const mins = [0, 1, 2].map((axis) => Math.min(...cartesian.map((item) => item[axis]))) as Vector;
    const maxs = [0, 1, 2].map((axis) => Math.max(...cartesian.map((item) => item[axis]))) as Vector;
    origin = mins.map((value) => value - 2) as Vector;
    lattice = {
      a: Math.max(maxs[0] - mins[0] + 4, 4),
      b: Math.max(maxs[1] - mins[1] + 4, 4),
      c: Math.max(maxs[2] - mins[2] + 4, 4),
      alpha: 90,
      beta: 90,
      gamma: 90,
    };
  }

  lattice.periodic = crystal ? [true, true, true] : [false, false, false];
  const atoms = rows.map((line, index) => {
    const rawElement = line.slice(76, 78).trim() || line.slice(12, 16).trim().replace(/[^A-Za-z]/g, '').slice(0, 2);
    const species = rawElement ? rawElement[0].toUpperCase() + rawElement.slice(1).toLowerCase() : 'X';
    const shifted = cartesian[index].map((value, axis) => value - origin[axis]) as Vector;
    return atom(`imported-atom-${index + 1}`, species, cartesianToFractional(shifted, lattice));
  });
  return { name: fallbackName, atoms, lattice };
}

function tokenizeCIF(line: string) {
  return line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((value) => value.replace(/^['"]|['"]$/g, '')) ?? [];
}

function cifSymmetryOperations(lines: string[]) {
  const keys = ['_space_group_symop_operation_xyz', '_symmetry_equiv_pos_as_xyz'];
  const operations: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const tokens = tokenizeCIF(lines[index]);
    if (keys.includes(tokens[0]?.toLowerCase()) && tokens.length > 1) operations.push(tokens[1]);
    if (lines[index].toLowerCase() !== 'loop_') continue;
    const headers: string[] = [];
    let cursor = index + 1;
    while (lines[cursor]?.startsWith('_')) headers.push(lines[cursor++].toLowerCase());
    const column = headers.findIndex((key) => keys.includes(key));
    if (column < 0) continue;
    while (cursor < lines.length && !/^(loop_|_|data_)/i.test(lines[cursor])) {
      const row = tokenizeCIF(lines[cursor++]);
      if (row.length >= headers.length && !row[0].startsWith('#')) operations.push(row[column]);
    }
  }
  if (operations.length > 384) throw new Error('CIF contains too many symmetry operations.');
  return [...new Set(operations)];
}

function applyCifSymmetry(operation: string, atom: CustomAtom): Vector {
  const parts = operation.toLowerCase().replace(/\s/g, '').split(',');
  if (parts.length !== 3) throw new Error(`Unsupported CIF symmetry operation: ${operation}`);
  return parts.map((part) => {
    const terms = part.match(/[+-]?[^+-]+/g) ?? [];
    if (!terms.length) throw new Error('Empty CIF symmetry expression.');
    const value = terms.reduce((sum, term) => {
      if (/^[+-]?[xyz]$/.test(term)) return sum + (term[0] === '-' ? -1 : 1) * atom[term.at(-1) as 'x' | 'y' | 'z'];
      if (/^[+-]?\d+(?:\/\d+|\.\d+)?$/.test(term)) return sum + cleanNumber(term);
      throw new Error(`Unsupported CIF symmetry expression: ${operation}`);
    }, 0);
    return ((value % 1) + 1) % 1;
  }) as Vector;
}

function parseCIF(text: string, fallbackName: string): ParsedStructure {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const lookup = (key: string, fallback: number) => {
    const line = lines.find((item) => item.toLowerCase().startsWith(key));
    return cleanNumber(tokenizeCIF(line ?? '')[1], fallback);
  };
  const lattice: LatticeParameters = {
    a: lookup('_cell_length_a', Number.NaN), b: lookup('_cell_length_b', Number.NaN), c: lookup('_cell_length_c', Number.NaN),
    alpha: lookup('_cell_angle_alpha', 90), beta: lookup('_cell_angle_beta', 90), gamma: lookup('_cell_angle_gamma', 90),
  };
  cellVectorsFromLattice(lattice);
  const operations = cifSymmetryOperations(lines);
  const groupNumber = lookup('_space_group_it_number', lookup('_symmetry_int_tables_number', 1));
  const groupName = lines.find((line) => /^_(space_group_name_h-m_alt|symmetry_space_group_name_h-m)\s/i.test(line));
  if (!operations.length && (groupNumber !== 1 || (groupName && tokenizeCIF(groupName)[1]?.replace(/\s/g, '').toLowerCase() !== 'p1'))) throw new Error('This CIF needs symmetry expansion. Include its symmetry-operation loop or export a complete P1 cell.');
  const atoms: CustomAtom[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toLowerCase() !== 'loop_') continue;
    const headers: string[] = [];
    let cursor = index + 1;
    while (lines[cursor]?.startsWith('_')) { headers.push(lines[cursor].toLowerCase()); cursor += 1; }
    const xIndex = headers.findIndex((header) => header.includes('_atom_site_fract_x'));
    const yIndex = headers.findIndex((header) => header.includes('_atom_site_fract_y'));
    const zIndex = headers.findIndex((header) => header.includes('_atom_site_fract_z'));
    if (xIndex < 0 || yIndex < 0 || zIndex < 0) continue;
    const symbolIndex = headers.findIndex((header) => header.includes('_atom_site_type_symbol'));
    const labelIndex = headers.findIndex((header) => header.includes('_atom_site_label'));
    const occupancyIndex = headers.indexOf('_atom_site_occupancy');
    while (cursor < lines.length && lines[cursor] && !lines[cursor].startsWith('_') && lines[cursor].toLowerCase() !== 'loop_') {
      if (!lines[cursor].startsWith('#')) {
        const values = tokenizeCIF(lines[cursor]);
        if (values.length >= headers.length) atoms.push({ ...atom(
          `imported-atom-${atoms.length + 1}`,
          values[symbolIndex >= 0 ? symbolIndex : labelIndex],
          [cleanNumber(values[xIndex]), cleanNumber(values[yIndex]), cleanNumber(values[zIndex])],
          labelIndex >= 0 ? values[labelIndex] : undefined,
        ), ...(occupancyIndex >= 0 ? { occupancy: cleanNumber(values[occupancyIndex]) } : {}) });
      }
      cursor += 1;
    }
  }
  if (!atoms.length) throw new Error('No fractional atom loop was found in the CIF file.');
  const expanded: CustomAtom[] = [];
  const seen = new Set<string>();
  for (const site of atoms) {
    for (const operation of operations.length ? operations : ['x,y,z']) {
      const [x, y, z] = operations.length ? applyCifSymmetry(operation, site) : [site.x, site.y, site.z];
      const key = `${site.species}/${[x, y, z].map((v) => Math.round((((v % 1) + 1) % 1) * 1e6) % 1e6).join('/')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      expanded.push({ ...site, id: `imported-atom-${expanded.length + 1}`, x, y, z });
      if (expanded.length > 5000) throw new Error('Expanded CIF exceeds the 5,000 atom import limit.');
    }
  }
  return { name: fallbackName, atoms: expanded, lattice };
}

const BOHR_TO_ANGSTROM = 0.529177210903;

function quantumEspressoScalar(text: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`(?:^|[\\s,])${escaped}\\s*=\\s*([^,\\s/]+)`, 'im'));
  return match ? cleanNumber(match[1], Number.NaN) : Number.NaN;
}

function quantumEspressoCardUnit(header: string, fallback: string) {
  const bracketed = header.match(/[({]\s*([^})]+)\s*[})]/)?.[1]?.trim().toLowerCase();
  const plain = header.trim().split(/\s+/)[1]?.toLowerCase();
  const raw = bracketed || plain || fallback;
  const alatMatch = raw.match(/alat\s*=\s*([+\-\d.eEdD]+)/);
  return { unit: raw.startsWith('angstrom') ? 'angstrom' : raw.startsWith('bohr') ? 'bohr' : raw.startsWith('crystal_sg') ? 'crystal_sg' : raw.startsWith('crystal') ? 'crystal' : 'alat', alatBohr: alatMatch ? cleanNumber(alatMatch[1], Number.NaN) : Number.NaN };
}

function lastQuantumEspressoCard(lines: string[], card: string) {
  let index = -1;
  lines.forEach((line, lineIndex) => {
    if (line.trim().toUpperCase().startsWith(card)) index = lineIndex;
  });
  return index;
}

function quantumEspressoLatticeFromIbrav(text: string): [Vector, Vector, Vector] | null {
  const ibrav = Math.trunc(quantumEspressoScalar(text, 'ibrav'));
  if (!Number.isFinite(ibrav)) return null;
  const celldm1 = quantumEspressoScalar(text, 'celldm(1)');
  const a = Number.isFinite(quantumEspressoScalar(text, 'A'))
    ? quantumEspressoScalar(text, 'A')
    : Number.isFinite(celldm1) ? celldm1 * BOHR_TO_ANGSTROM : Number.NaN;
  const bValue = quantumEspressoScalar(text, 'B');
  const cValue = quantumEspressoScalar(text, 'C');
  const ratioB = quantumEspressoScalar(text, 'celldm(2)');
  const ratioC = quantumEspressoScalar(text, 'celldm(3)');
  const b = Number.isFinite(bValue) ? bValue : Number.isFinite(ratioB) ? a * ratioB : Number.NaN;
  const c = Number.isFinite(cValue) ? cValue : Number.isFinite(ratioC) ? a * ratioC : Number.NaN;
  if (!Number.isFinite(a) || a <= 0) return null;
  if (ibrav === 1) return [[a, 0, 0], [0, a, 0], [0, 0, a]];
  if (ibrav === 2) return [[-a / 2, 0, a / 2], [0, a / 2, a / 2], [-a / 2, a / 2, 0]];
  if (ibrav === 3) return [[a / 2, a / 2, a / 2], [-a / 2, a / 2, a / 2], [-a / 2, -a / 2, a / 2]];
  if (ibrav === -3) return [[-a / 2, a / 2, a / 2], [a / 2, -a / 2, a / 2], [a / 2, a / 2, -a / 2]];
  if (ibrav === 4) return [[a, 0, 0], [-a / 2, Math.sqrt(3) * a / 2, 0], [0, 0, c]];
  if (ibrav === 6) return [[a, 0, 0], [0, a, 0], [0, 0, c]];
  if (ibrav === 8) return [[a, 0, 0], [0, b, 0], [0, 0, c]];
  return null;
}

function parseQuantumEspresso(text: string, fallbackName: string): ParsedStructure {
  const cleaned = text.split(/\r?\n/).map((line) => line.replace(/!.*$/, '').trimEnd()).join('\n');
  const lines = cleaned.split(/\r?\n/);
  const cellIndex = lastQuantumEspressoCard(lines, 'CELL_PARAMETERS');
  let vectors: [Vector, Vector, Vector] | null = null;
  let alatAngstrom = Number.NaN;
  const aParameter = quantumEspressoScalar(cleaned, 'A');
  const celldm1 = quantumEspressoScalar(cleaned, 'celldm(1)');
  if (Number.isFinite(aParameter)) alatAngstrom = aParameter;
  else if (Number.isFinite(celldm1)) alatAngstrom = celldm1 * BOHR_TO_ANGSTROM;

  if (cellIndex >= 0) {
    const header = quantumEspressoCardUnit(lines[cellIndex], 'alat');
    if (Number.isFinite(header.alatBohr)) alatAngstrom = header.alatBohr * BOHR_TO_ANGSTROM;
    const rows = lines.slice(cellIndex + 1).filter((line) => line.trim()).slice(0, 3);
    if (rows.length < 3) throw new Error('Quantum ESPRESSO CELL_PARAMETERS block is incomplete.');
    if (header.unit === 'alat' && !Number.isFinite(alatAngstrom)) throw new Error('CELL_PARAMETERS alat requires A or celldm(1).');
    const factor = header.unit === 'bohr' ? BOHR_TO_ANGSTROM : header.unit === 'alat' ? (Number.isFinite(alatAngstrom) ? alatAngstrom : 1) : 1;
    vectors = rows.map((line) => line.trim().split(/\s+/).slice(0, 3).map((value) => cleanNumber(value) * factor) as Vector) as [Vector, Vector, Vector];
  } else {
    vectors = quantumEspressoLatticeFromIbrav(cleaned);
  }
  if (!vectors) throw new Error('Quantum ESPRESSO import needs CELL_PARAMETERS (ibrav = 0) or a supported ibrav lattice.');

  const positionsIndex = lastQuantumEspressoCard(lines, 'ATOMIC_POSITIONS');
  if (positionsIndex < 0) throw new Error('Quantum ESPRESSO ATOMIC_POSITIONS block was not found.');
  const positionHeader = quantumEspressoCardUnit(lines[positionsIndex], 'alat');
  if (Number.isFinite(positionHeader.alatBohr)) alatAngstrom = positionHeader.alatBohr * BOHR_TO_ANGSTROM;
  if (positionHeader.unit === 'crystal_sg') throw new Error('ATOMIC_POSITIONS crystal_sg needs symmetry expansion; import an expanded structure instead.');
  if (positionHeader.unit === 'alat' && !Number.isFinite(alatAngstrom)) throw new Error('ATOMIC_POSITIONS alat requires A or celldm(1).');
  const nat = Math.trunc(quantumEspressoScalar(cleaned, 'nat'));
  const cardNames = /^(ATOMIC_SPECIES|ATOMIC_POSITIONS|CELL_PARAMETERS|K_POINTS|CONSTRAINTS|OCCUPATIONS|ATOMIC_FORCES|HUBBARD|SOLVENTS|BEGIN|END|&)/i;
  const rows: string[] = [];
  for (let index = positionsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (rows.length) break;
      continue;
    }
    if (cardNames.test(line)) break;
    rows.push(line);
    if (Number.isFinite(nat) && rows.length >= nat) break;
  }
  if (!rows.length || (Number.isFinite(nat) && rows.length < nat)) throw new Error('Quantum ESPRESSO atomic coordinates are incomplete.');
  const atoms = rows.map((row, index) => {
    const values = row.split(/\s+/);
    if (values.length < 4) throw new Error(`Quantum ESPRESSO atom row ${index + 1} is incomplete.`);
    const position = values.slice(1, 4).map((value) => cleanNumber(value)) as Vector;
    const cartesian = positionHeader.unit === 'bohr'
      ? position.map((value) => value * BOHR_TO_ANGSTROM) as Vector
      : positionHeader.unit === 'angstrom'
        ? position
        : positionHeader.unit === 'alat'
          ? position.map((value) => value * alatAngstrom) as Vector
          : null;
    const fractional = cartesian ? cartesianToFractionalWithVectors(cartesian, vectors) : position;
    return atom(`imported-atom-${index + 1}`, values[0], fractional);
  });
  return { name: fallbackName, atoms, lattice: vectorsToLattice(vectors) };
}

export const STRUCTURE_FILE_ACCEPT = '.cif,.xsf,.axsf,.vasp,.poscar,.contcar,.xyz,.extxyz,.pdb,.in,.pwi,.pw,.qe,.out,.pwo';

export function isSupportedStructureFileName(fileName: string) {
  const baseName = fileName.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  return baseName === 'poscar'
    || baseName === 'contcar'
    || /\.(cif|xsf|axsf|vasp|poscar|contcar|xyz|extxyz|pdb|in|pwi|pw|qe|out|pwo)$/i.test(baseName);
}

function parseStructureContent(text: string, fileName: string): ParsedStructure {
  const name = fileName.replace(/\.[^.]+$/, '') || 'Imported structure';
  const lower = fileName.toLowerCase();
  const quantumEspressoLike = /&\s*SYSTEM\b/i.test(text) && /ATOMIC_POSITIONS\b/i.test(text);
  if (quantumEspressoLike || /\.(pwi|pw|qe|pwo)$/i.test(lower) || ((lower.endsWith('.in') || lower.endsWith('.out')) && /ATOMIC_POSITIONS\b/i.test(text))) return parseQuantumEspresso(text, name);
  if (lower.endsWith('.xyz') || lower.endsWith('.extxyz')) return parseXYZ(text, name);
  if (lower.endsWith('.cif')) return parseCIF(text, name);
  if (lower.endsWith('.xsf') || lower.endsWith('.axsf')) return parseXSF(text, name);
  if (lower.endsWith('.pdb')) return parsePDB(text, name);
  if (lower.includes('poscar') || lower.includes('contcar') || lower.endsWith('.vasp')) return parsePOSCAR(text, name);
  if (/(?:^|\n)\s*data_[^\r\n]+/i.test(text) || /(?:^|\n)\s*_(?:cell_length_|atom_site_)/i.test(text)) return parseCIF(text, name);
  if (/(?:^|\n)\s*(?:PRIMVEC|PRIMCOORD|#\s*CRYSTAL|#\s*SLAB)/i.test(text)) return parseXSF(text, name);
  if (/(?:^|\n)\s*(?:HEADER|CRYST1|ATOM\s+|HETATM\s+)/i.test(text)) return parsePDB(text, name);
  if (/^\s*\d+\s*\r?\n/.test(text) && text.trim().split('\n').length > 2) return parseXYZ(text, name);
  if (/(?:^|\n)\s*(?:Direct|Cartesian)\s*(?:\r?\n|$)/i.test(text)) return parsePOSCAR(text, name);
  throw new Error('Use CIF, XSF/AXSF, POSCAR/CONTCAR, VASP, XYZ/EXTXYZ, PDB, or Quantum ESPRESSO input/output.');
}

export function parseStructureText(text: string, fileName: string): ParsedStructure {
  const parsed = parseStructureContent(text, fileName);
  cellVectorsFromLattice(parsed.lattice);
  if (!parsed.atoms.length || parsed.atoms.length > 5000) throw new Error('Import a structure containing 1 to 5,000 atoms.');
  if (parsed.atoms.some((atom) => ![atom.x, atom.y, atom.z].every(Number.isFinite) || (atom.occupancy !== undefined && (!Number.isFinite(atom.occupancy) || atom.occupancy <= 0 || atom.occupancy > 1)))) throw new Error('Atomic coordinates must be finite and site occupancies must be between 0 and 1.');
  return parsed;
}

export async function parseStructureFile(file: File): Promise<ParsedStructure> {
  return parseStructureText(await file.text(), file.name);
}

export function createXYZ(name: string, atoms: CustomAtom[], lattice: LatticeParameters) {
  const occupancyIssue = orderedStructureIssue(atoms);
  if (occupancyIssue) throw new Error(occupancyIssue);
  const rows = atoms.map((item) => {
    const [x, y, z] = fractionalToCartesian(item, lattice);
    return `${item.species.padEnd(3)} ${x.toFixed(8)} ${y.toFixed(8)} ${z.toFixed(8)}`;
  });
  const vectors = cellVectorsFromLattice(lattice).flat().map((value) => value.toFixed(8)).join(' ');
  return `${atoms.length}\nLattice="${vectors}" Properties=species:S:1:pos:R:3 pbc="${(lattice.periodic ?? [true, true, true]).map((v) => v ? 'T' : 'F').join(' ')}" Name="${name}"\n${rows.join('\n')}\n`;
}

export function createCIF(name: string, atoms: CustomAtom[], lattice: LatticeParameters) {
  const safeName = name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_') || 'cristal_builder_structure';
  const rows = atoms.flatMap((item, index) => {
    const siteSpecies = item.siteSpecies?.length
      ? item.siteSpecies
      : [{ element: item.species, species: item.species, occupancy: item.occupancy ?? 1 }];
    return siteSpecies.map((entry, speciesIndex) => {
      const suffix = siteSpecies.length > 1 ? `_${speciesIndex + 1}` : '';
      const label = `${item.label?.trim() || `${entry.element}${index + 1}`}${suffix}`.replace(/\s+/g, '_');
      return `${label} ${entry.species} ${item.x.toFixed(8)} ${item.y.toFixed(8)} ${item.z.toFixed(8)} ${entry.occupancy.toFixed(8)}`;
    });
  });
  return [
    `data_${safeName}`,
    `_cell_length_a ${lattice.a.toFixed(8)}`,
    `_cell_length_b ${lattice.b.toFixed(8)}`,
    `_cell_length_c ${lattice.c.toFixed(8)}`,
    `_cell_angle_alpha ${lattice.alpha.toFixed(6)}`,
    `_cell_angle_beta ${lattice.beta.toFixed(6)}`,
    `_cell_angle_gamma ${lattice.gamma.toFixed(6)}`,
    "_symmetry_space_group_name_H-M 'P 1'",
    '_symmetry_Int_Tables_number 1',
    '',
    'loop_',
    '_atom_site_label',
    '_atom_site_type_symbol',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    '_atom_site_occupancy',
    ...rows,
    '',
  ].join('\n');
}

export function createXSF(name: string, atoms: CustomAtom[], lattice: LatticeParameters) {
  const occupancyIssue = orderedStructureIssue(atoms);
  if (occupancyIssue) throw new Error(occupancyIssue);
  const vectors = cellVectorsFromLattice(lattice);
  const periodic = lattice.periodic ?? [true, true, true];
  const dimension = periodic.filter(Boolean).length;
  const orderedVectors = vectors.map((vector, axis) => ({ vector, periodic: periodic[axis] })).sort((a, b) => Number(b.periodic) - Number(a.periodic)).map((entry) => entry.vector);
  const rows = atoms.map((item) => {
    const [x, y, z] = fractionalToCartesian(item, lattice);
    const force = [item.fx, item.fy, item.fz].every((value) => typeof value === 'number')
      ? ` ${item.fx!.toFixed(8)} ${item.fy!.toFixed(8)} ${item.fz!.toFixed(8)}`
      : '';
    return `${item.species.padEnd(3)} ${x.toFixed(8)} ${y.toFixed(8)} ${z.toFixed(8)}${force}`;
  });
  if (dimension === 0) return [`# ${name || 'Structure'}`, 'ATOMS', ...rows, ''].join('\n');
  return [
    `# ${name || 'DFT Lab structure'}`,
    dimension === 2 ? 'SLAB' : dimension === 1 ? 'POLYMER' : 'CRYSTAL',
    'PRIMVEC',
    ...orderedVectors.map((vector) => vector.map((value) => value.toFixed(10)).join(' ')),
    'PRIMCOORD',
    `${atoms.length} 1`,
    ...rows,
    '',
  ].join('\n');
}

export function createPOSCAR(name: string, atoms: CustomAtom[], lattice: LatticeParameters) {
  const occupancyIssue = orderedStructureIssue(atoms);
  if (occupancyIssue) throw new Error(occupancyIssue);
  const species = Array.from(new Set(atoms.map((item) => item.species)));
  const grouped = species.flatMap((symbol) => atoms.filter((item) => item.species === symbol));
  const counts = species.map((symbol) => atoms.filter((item) => item.species === symbol).length);
  const vectors = cellVectorsFromLattice(lattice);
  return [
    name || 'DFT Lab structure',
    '1.0',
    ...vectors.map((vector) => vector.map((value) => value.toFixed(10)).join(' ')),
    species.join(' '),
    counts.join(' '),
    'Direct',
    ...grouped.map((item) => `${item.x.toFixed(10)} ${item.y.toFixed(10)} ${item.z.toFixed(10)}`),
    '',
  ].join('\n');
}
