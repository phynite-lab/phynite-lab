import * as THREE from 'three';
import { cellVectorsFromLattice as cellVectors } from './crystal-cell.ts';
import { labCameraBounds, type LabCameraBounds } from './lab-camera.ts';
import { mdElementAppearance } from './md-element-appearance.ts';
import type { CustomAtom, LatticeParameters } from '@/components/CrystalViewer';

export type CrystalPoint = [number, number, number];
export type CrystalDisplayStyle = 'ball-stick' | 'spacefill' | 'wireframe';

export type EditorAtom = {
  id: string;
  instanceId: string;
  species: string;
  position: CrystalPoint;
  radius: number;
  cellOffset: CrystalPoint;
  force?: CrystalPoint;
};

export type CrystalRenderBoundsSource = {
  atoms: ReadonlyArray<Pick<EditorAtom, 'position' | 'radius'>>;
  edges: ReadonlyArray<readonly [CrystalPoint, CrystalPoint]>;
};

/** Bounds every visible atom radius and cell edge after the viewport rotation. */
export function crystalRenderBounds(
  model: CrystalRenderBoundsSource,
  rotation = new THREE.Quaternion(),
): LabCameraBounds {
  return labCameraBounds([
    ...model.edges.flatMap(([start, end]) => [
      { position: new THREE.Vector3(...start).applyQuaternion(rotation) },
      { position: new THREE.Vector3(...end).applyQuaternion(rotation) },
    ]),
    ...model.atoms.map((atom) => ({
      position: new THREE.Vector3(...atom.position).applyQuaternion(rotation),
      radius: atom.radius,
    })),
  ]);
}

const CURATED_ELEMENT_APPEARANCE: Record<string, { color: string; radius: number }> = {
  H: { color: '#f5f6f8', radius: 0.19 },
  C: { color: '#3f434a', radius: 0.27 },
  N: { color: '#4f69c6', radius: 0.28 },
  O: { color: '#d9434b', radius: 0.27 },
  F: { color: '#62ad72', radius: 0.26 },
  Na: { color: '#8a72c6', radius: 0.37 },
  Mg: { color: '#79ae69', radius: 0.34 },
  Al: { color: '#b9a5a7', radius: 0.34 },
  Si: { color: '#e8bb91', radius: 0.34 },
  P: { color: '#dc8743', radius: 0.31 },
  S: { color: '#d7b33c', radius: 0.3 },
  Cl: { color: '#5eaa68', radius: 0.31 },
  Ti: { color: '#9099a3', radius: 0.36 },
  Fe: { color: '#b96d4d', radius: 0.35 },
  Co: { color: '#92979e', radius: 0.34 },
  Ni: { color: '#3446ad', radius: 0.34 },
  Cu: { color: '#c58352', radius: 0.35 },
  Ga: { color: '#9b7f82', radius: 0.35 },
  As: { color: '#9b74b5', radius: 0.34 },
  Br: { color: '#9f4b46', radius: 0.35 },
  Zr: { color: '#55a7aa', radius: 0.38 },
  Mo: { color: '#5b9c9c', radius: 0.38 },
  Se: { color: '#c5a84b', radius: 0.35 },
  Mn: { color: '#9c7ac7', radius: 0.34 },
  Te: { color: '#d47a00', radius: 0.37 },
};

function defaultBallRadius(covalentRadius: number): number {
  return Math.max(0.2, Math.min(0.42, Number((0.14 + covalentRadius * 0.15).toFixed(2))));
}

export const elementAppearance: Record<string, { color: string; radius: number }> = Object.fromEntries(
  Object.entries(mdElementAppearance).map(([symbol, preset]) => [
    symbol,
    CURATED_ELEMENT_APPEARANCE[symbol] ?? {
      color: preset.color,
      radius: defaultBallRadius(preset.radius),
    },
  ]),
);

export function normalizedElementSymbol(species: string) {
  const match = species.trim().match(/^([A-Z][a-z]?)/i);
  if (!match) return species.trim() || 'X';
  return `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}`;
}

export function appearanceFor(species: string) {
  const element = normalizedElementSymbol(species);
  if (elementAppearance[element]) return elementAppearance[element];
  const mdPreset = mdElementAppearance[element];
  if (mdPreset) {
    return {
      color: mdPreset.color,
      radius: defaultBallRadius(mdPreset.radius),
    };
  }
  const hue = Array.from(element).reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 360;
  return { color: `hsl(${hue} 46% 58%)`, radius: 0.34 };
}

export function covalentRadiusFor(species: string): number {
  const element = normalizedElementSymbol(species);
  if (element === 'B') return 0.84;
  const mdPreset = mdElementAppearance[element];
  if (mdPreset && mdPreset.radius > 0) return mdPreset.radius;
  return 1.25;
}

export function atomInstanceId(atomId: string, offset: CrystalPoint) {
  return `${atomId}@${offset[0]},${offset[1]},${offset[2]}`;
}

function offsetsInsideDrawnAxis(coordinate: number, repeat: number) {
  const epsilon = 1e-8;
  const first = Math.ceil(-coordinate - epsilon);
  const last = Math.floor(repeat - coordinate + epsilon);
  const offsets: number[] = [];
  for (let offset = first; offset <= last; offset += 1) offsets.push(offset);
  return offsets;
}

export function cellOffsetFromAtomInstance(atomId: string, instanceId: string): CrystalPoint {
  const modernSuffix = instanceId.startsWith(`${atomId}@`) ? instanceId.slice(atomId.length + 1) : '';
  if (modernSuffix) {
    const values = modernSuffix.split(',').map((value) => Number.parseInt(value, 10));
    if (values.length === 3 && values.every(Number.isFinite)) return values as CrystalPoint;
  }

  // Retain compatibility with selections produced before periodic-image support.
  const legacySuffix = instanceId.startsWith(`${atomId}-`) ? instanceId.slice(atomId.length + 1) : '';
  const legacyValues = legacySuffix.split('-').map((value) => Number.parseInt(value, 10));
  return legacyValues.length === 3 && legacyValues.every(Number.isFinite)
    ? legacyValues as CrystalPoint
    : [0, 0, 0];
}

function cellVectorsFromLattice(lattice: LatticeParameters): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
  return cellVectors(lattice).map((v) => new THREE.Vector3(...v)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
}

export function buildCrystalRenderModel(
  atoms: CustomAtom[],
  lattice: LatticeParameters,
  supercell: [number, number, number],
  atomScale: number,
  bondCutoff: number,
  displayStyle: CrystalDisplayStyle,
) {
  const periodic = lattice.periodic ?? [true, true, true];
  const repeats = supercell.map((value, axis) => periodic[axis] ? Math.max(1, Math.min(8, Math.round(value))) : 1) as [number, number, number];
  const [rawA, rawB, rawC] = cellVectorsFromLattice(lattice);
  const scale = 5.4 / Math.max(rawA.length(), rawB.length(), rawC.length(), 0.1);
  const primaryA = rawA.clone().multiplyScalar(scale);
  const primaryB = rawB.clone().multiplyScalar(scale);
  const primaryC = rawC.clone().multiplyScalar(scale);
  const cellA = primaryA.clone().multiplyScalar(repeats[0]);
  const cellB = primaryB.clone().multiplyScalar(repeats[1]);
  const cellC = primaryC.clone().multiplyScalar(repeats[2]);
  const origin = cellA.clone().add(cellB).add(cellC).multiplyScalar(-0.5);
  const toWorldOffset = (item: CustomAtom, offset: CrystalPoint) => origin
    .clone()
    .add(primaryA.clone().multiplyScalar(item.x + offset[0]))
    .add(primaryB.clone().multiplyScalar(item.y + offset[1]))
    .add(primaryC.clone().multiplyScalar(item.z + offset[2]));
  const toWorld = ([x, y, z]: CrystalPoint) => origin
    .clone()
    .add(cellA.clone().multiplyScalar(x))
    .add(cellB.clone().multiplyScalar(y))
    .add(cellC.clone().multiplyScalar(z));
  const basis = new THREE.Matrix3().set(
    cellA.x, cellB.x, cellC.x,
    cellA.y, cellB.y, cellC.y,
    cellA.z, cellB.z, cellC.z,
  );
  const inverseBasis = basis.clone().invert();
  const worldToFractional = (position: THREE.Vector3): CrystalPoint => {
    const normalized = position.clone().sub(origin).applyMatrix3(inverseBasis);
    return [
      normalized.x * repeats[0],
      normalized.y * repeats[1],
      normalized.z * repeats[2],
    ];
  };

  const cellAspectRadiusScale = Math.max(
    0.5,
    Math.min(1, 5.4 / Math.max(rawA.length(), rawB.length(), rawC.length(), 0.1)),
  );
  const styleScale = displayStyle === 'spacefill' ? 1.75 : displayStyle === 'wireframe' ? 0.34 : 1;
  const renderAtom = (item: CustomAtom, offset: CrystalPoint): EditorAtom => {
    const position = toWorldOffset(item, offset);
    const species = normalizedElementSymbol(item.species);
    return {
      id: item.id,
      instanceId: atomInstanceId(item.id, offset),
      species,
      position: position.toArray() as CrystalPoint,
      radius: appearanceFor(species).radius * atomScale * cellAspectRadiusScale * styleScale,
      cellOffset: offset,
      ...([item.fx, item.fy, item.fz].every((value) => typeof value === 'number' && Number.isFinite(value)) ? {
        force: [item.fx! * scale, item.fy! * scale, item.fz! * scale] as CrystalPoint,
      } : {}),
    };
  };

  const atomByInstance = new Map<string, EditorAtom>();
  atoms.forEach((item) => {
    const aOffsets = periodic[0] ? offsetsInsideDrawnAxis(item.x, repeats[0]) : [0];
    const bOffsets = periodic[1] ? offsetsInsideDrawnAxis(item.y, repeats[1]) : [0];
    const cOffsets = periodic[2] ? offsetsInsideDrawnAxis(item.z, repeats[2]) : [0];
    aOffsets.forEach((a) => {
      bOffsets.forEach((b) => {
        cOffsets.forEach((c) => {
          const offset: CrystalPoint = [a, b, c];
          const rendered = renderAtom(item, offset);
          atomByInstance.set(rendered.instanceId, rendered);
        });
      });
    });
  });
  const primaryAtoms = Array.from(atomByInstance.values());

  const edges: Array<[CrystalPoint, CrystalPoint]> = [];
  const gridPoint = (a: number, b: number, c: number) => toWorld([
    a / repeats[0],
    b / repeats[1],
    c / repeats[2],
  ]).toArray() as CrystalPoint;
  for (let a = 0; a <= repeats[0]; a += 1) {
    for (let b = 0; b <= repeats[1]; b += 1) {
      for (let c = 0; c <= repeats[2]; c += 1) {
        if (a < repeats[0]) edges.push([gridPoint(a, b, c), gridPoint(a + 1, b, c)]);
        if (b < repeats[1]) edges.push([gridPoint(a, b, c), gridPoint(a, b + 1, c)]);
        if (c < repeats[2]) edges.push([gridPoint(a, b, c), gridPoint(a, b, c + 1)]);
      }
    }
  }

  // Cartesian bins handle skew cells and arbitrary cutoffs without a 27-image
  // assumption. Only visible endpoints can produce a displayed neighbor line.
  const maxBondDistance = bondCutoff > 0 ? bondCutoff : 4.8;
  const searchRadius = maxBondDistance * scale;
  const bins = new Map<string, number[]>();
  const binFor = (point: CrystalPoint) => point.map((v) => Math.floor(v / searchRadius));
  primaryAtoms.forEach((atom, index) => {
    const key = binFor(atom.position).join(',');
    const bucket = bins.get(key) ?? [];
    bucket.push(index);
    bins.set(key, bucket);
  });
  const visitPairs = (visit: (i: number, j: number, distance: number) => void) => {
    primaryAtoms.forEach((atom, i) => {
      const bin = binFor(atom.position);
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        const bucket = bins.get(`${bin[0] + x},${bin[1] + y},${bin[2] + z}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const other = primaryAtoms[j].position;
          const distance = Math.hypot(atom.position[0] - other[0], atom.position[1] - other[1], atom.position[2] - other[2]);
          if (distance > 1e-6 * scale && distance <= searchRadius + 1e-8) visit(i, j, distance);
        }
      }
    });
  };
  const bonds: Array<[CrystalPoint, CrystalPoint]> = [];
  let omittedBonds = 0;
  visitPairs((i, j, distance) => {
    const realDistance = distance / scale;
    if (realDistance < 0.4) return;
    if (bondCutoff > 0) {
      if (realDistance > bondCutoff) return;
    } else {
      const maxAllowed = (covalentRadiusFor(primaryAtoms[i].species) + covalentRadiusFor(primaryAtoms[j].species)) * 1.15;
      if (realDistance > maxAllowed) return;
    }
    if (bonds.length >= 4000) { omittedBonds++; return; }
    bonds.push([primaryAtoms[i].position, primaryAtoms[j].position]);
  });

  return {
    atoms: Array.from(atomByInstance.values()),
    primaryAtomCount: primaryAtoms.length,
    repeats,
    bonds,
    omittedBonds,
    edges,
    fractionalToWorld: (point: CrystalPoint) => toWorldOffset({ x: point[0], y: point[1], z: point[2] } as CustomAtom, [0, 0, 0]).toArray() as CrystalPoint,
    worldToFractional,
  };
}
