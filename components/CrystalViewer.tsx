'use client';

import { cellVectorsFromLattice, type LatticeParameters } from '@/lib/crystal-cell';

import { Line, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Maximize2, MousePointer2, Rotate3D } from 'lucide-react';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { cn } from '@/lib/utils';

type Point = [number, number, number];
export type CrystalSpecies = string;
type Species = CrystalSpecies;

export type CrystalStructure =
  | 'Diamond cubic'
  | 'Zinc blende'
  | 'Face-centered cubic'
  | 'Body-centered cubic'
  | 'Hexagonal'
  | 'Free structure';

export type CustomAtom = {
  id: string;
  species: CrystalSpecies;
  label?: string;
  x: number;
  y: number;
  z: number;
  fx?: number;
  fy?: number;
  fz?: number;
  occupancy?: number;
  siteSpecies?: Array<{
    element: string;
    species: string;
    occupancy: number;
  }>;
};

export type { LatticeParameters } from '@/lib/crystal-cell';


type FractionalSite = {
  position: Point;
  species: Species;
};

type RenderAtom = {
  position: Point;
  species: Species;
  radius: number;
};

const knownElementStyles: Record<string, { color: string; radius: number }> = {
  H: { color: '#f5f6f8', radius: 0.11 },
  N: { color: '#4f69c6', radius: 0.15 },
  O: { color: '#d85b62', radius: 0.15 },
  F: { color: '#62ad72', radius: 0.14 },
  Na: { color: '#8a72c6', radius: 0.21 },
  Mg: { color: '#79ae69', radius: 0.2 },
  Al: { color: '#b9a5a7', radius: 0.2 },
  Si: { color: '#e8bb91', radius: 0.19 },
  C: { color: '#3f434a', radius: 0.16 },
  Mo: { color: '#5b9c9c', radius: 0.22 },
  S: { color: '#d7b33c', radius: 0.17 },
  P: { color: '#dc8743', radius: 0.18 },
  Cl: { color: '#5eaa68', radius: 0.18 },
  K: { color: '#8a72c6', radius: 0.23 },
  Ca: { color: '#79ae69', radius: 0.22 },
  Ti: { color: '#9099a3', radius: 0.21 },
  Fe: { color: '#b96d4d', radius: 0.2 },
  Ni: { color: '#70947b', radius: 0.2 },
  Cu: { color: '#c58352', radius: 0.2 },
  Ga: { color: '#9b7f82', radius: 0.2 },
  As: { color: '#9b74b5', radius: 0.2 },
};

function getElementStyle(species: Species) {
  if (knownElementStyles[species]) return knownElementStyles[species];
  const hash = Array.from(species).reduce((total, character) => total + character.charCodeAt(0), 0);
  return { color: `hsl(${hash % 360} 52% 52%)`, radius: 0.19 };
}

const defaultsByComposition: Record<string, { structure: CrystalStructure; lattice: LatticeParameters }> = {
  Si: {
    structure: 'Diamond cubic',
    lattice: { a: 5.431, b: 5.431, c: 5.431, alpha: 90, beta: 90, gamma: 90 },
  },
  C: {
    structure: 'Diamond cubic',
    lattice: { a: 3.567, b: 3.567, c: 3.567, alpha: 90, beta: 90, gamma: 90 },
  },
  'MoS₂': {
    structure: 'Hexagonal',
    lattice: { a: 3.16, b: 3.16, c: 12.29, alpha: 90, beta: 90, gamma: 120 },
  },
  GaAs: {
    structure: 'Zinc blende',
    lattice: { a: 5.653, b: 5.653, c: 5.653, alpha: 90, beta: 90, gamma: 90 },
  },
};

const fccSites: Point[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
  [0.5, 0.5, 0],
  [0.5, 0.5, 1],
  [0.5, 0, 0.5],
  [0.5, 1, 0.5],
  [0, 0.5, 0.5],
  [1, 0.5, 0.5],
];

const cornerSites: Point[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

const diamondPrimary: Point[] = [
  [0, 0, 0],
  [0, 0.5, 0.5],
  [0.5, 0, 0.5],
  [0.5, 0.5, 0],
];

const diamondSecondary: Point[] = [
  [0.25, 0.25, 0.25],
  [0.25, 0.75, 0.75],
  [0.75, 0.25, 0.75],
  [0.75, 0.75, 0.25],
];

function primarySpecies(composition: string): Species {
  if (composition === 'C') return 'C';
  if (composition === 'MoS₂') return 'Mo';
  if (composition === 'GaAs') return 'Ga';
  return 'Si';
}

function secondarySpecies(composition: string): Species {
  if (composition === 'MoS₂') return 'S';
  if (composition === 'GaAs') return 'As';
  return primarySpecies(composition);
}

function createFractionalSites(
  composition: string,
  structure: CrystalStructure,
  customAtoms?: CustomAtom[],
): FractionalSite[] {
  const primary = primarySpecies(composition);
  const secondary = secondarySpecies(composition);

  if (structure === 'Free structure') {
    const atoms = customAtoms?.length
      ? customAtoms
      : [{ id: 'free-atom-1', species: primary, x: 0, y: 0, z: 0 }];
    return atoms.map((atom) => ({
      species: atom.species,
      position: [
        Number.isFinite(atom.x) ? atom.x : 0,
        Number.isFinite(atom.y) ? atom.y : 0,
        Number.isFinite(atom.z) ? atom.z : 0,
      ],
    }));
  }

  if (structure === 'Diamond cubic' || structure === 'Zinc blende') {
    const isBinary = composition === 'GaAs' || composition === 'MoS₂';
    return [
      ...diamondPrimary.map((position) => ({ position, species: primary })),
      ...diamondSecondary.map((position) => ({
        position,
        species: structure === 'Zinc blende' || isBinary ? secondary : primary,
      })),
    ];
  }

  if (structure === 'Face-centered cubic') {
    return fccSites.map((position, index) => ({
      position,
      species: composition === 'GaAs' && index >= 8 ? secondary : primary,
    }));
  }

  if (structure === 'Body-centered cubic') {
    return [
      ...cornerSites.map((position) => ({ position, species: primary })),
      { position: [0.5, 0.5, 0.5] as Point, species: secondary },
    ];
  }

  if (composition === 'MoS₂') {
    return [
      { position: [0, 0, 0.5], species: 'Mo' },
      { position: [2 / 3, 1 / 3, 0.5], species: 'Mo' },
      { position: [1 / 3, 2 / 3, 0.405], species: 'S' },
      { position: [1 / 3, 2 / 3, 0.595], species: 'S' },
      { position: [1, 0, 0.405], species: 'S' },
      { position: [1, 0, 0.595], species: 'S' },
    ];
  }

  if (composition === 'GaAs') {
    return [
      { position: [0, 0, 0.5], species: 'Ga' },
      { position: [2 / 3, 1 / 3, 0.5], species: 'Ga' },
      { position: [1 / 3, 2 / 3, 0.5], species: 'As' },
      { position: [1, 1, 0.5], species: 'As' },
    ];
  }

  return [
    { position: [0, 0, 0.5], species: primary },
    { position: [1 / 3, 2 / 3, 0.5], species: primary },
    { position: [2 / 3, 1 / 3, 0.5], species: primary },
    { position: [1, 0, 0.5], species: primary },
    { position: [0, 1, 0.5], species: primary },
    { position: [1, 1, 0.5], species: primary },
  ];
}

function validLength(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0.05 ? value : fallback;
}

function createCellVectors(
  lattice: LatticeParameters,
  replication: [number, number, number] = [1, 1, 1],
) {
  const [rawA, rawB, rawC] = cellVectorsFromLattice(lattice).map((v, axis) => new THREE.Vector3(...v).multiplyScalar(replication[axis]));
  const scale = 2.6 / Math.max(rawA.length(), rawB.length(), rawC.length());

  return {
    vectors: [
      rawA.multiplyScalar(scale),
      rawB.multiplyScalar(scale),
      rawC.multiplyScalar(scale),
    ] as const,
    scale,
  };
}

function vectorToPoint(vector: THREE.Vector3): Point {
  return [vector.x, vector.y, vector.z];
}

function createModel(
  composition: string,
  structure: CrystalStructure,
  lattice: LatticeParameters,
  customAtoms?: CustomAtom[],
  replication: [number, number, number] = [1, 1, 1],
  atomScale = 1,
  bondCutoff = 0,
) {
  const repeats = replication.map((value) => Math.max(1, Math.min(8, Math.round(value)))) as [number, number, number];
  const { vectors: [aVector, bVector, cVector], scale } = createCellVectors(lattice, repeats);
  const origin = aVector.clone().add(bVector).add(cVector).multiplyScalar(-0.5);
  const toCartesian = ([x, y, z]: Point) =>
    origin
      .clone()
      .add(aVector.clone().multiplyScalar(x))
      .add(bVector.clone().multiplyScalar(y))
      .add(cVector.clone().multiplyScalar(z));

  const baseSites = createFractionalSites(composition, structure, customAtoms);
  const fractionalSites: FractionalSite[] = [];
  for (let i = 0; i < repeats[0]; i += 1) {
    for (let j = 0; j < repeats[1]; j += 1) {
      for (let k = 0; k < repeats[2]; k += 1) {
        baseSites.forEach((site) => fractionalSites.push({
          species: site.species,
          position: [
            (site.position[0] + i) / repeats[0],
            (site.position[1] + j) / repeats[1],
            (site.position[2] + k) / repeats[2],
          ],
        }));
      }
    }
  }
  const repeatScale = Math.max(0.52, 1 / Math.cbrt(repeats[0] * repeats[1] * repeats[2]));
  const atoms: RenderAtom[] = fractionalSites.map((site) => ({
    position: vectorToPoint(toCartesian(site.position)),
    species: site.species,
    radius: getElementStyle(site.species).radius * atomScale * repeatScale,
  }));

  const edges: Array<[Point, Point]> = [];
  const gridPoint = (a: number, b: number, c: number) => vectorToPoint(toCartesian([
    a / repeats[0],
    b / repeats[1],
    c / repeats[2],
  ]));
  for (let a = 0; a <= repeats[0]; a += 1) {
    for (let b = 0; b <= repeats[1]; b += 1) {
      for (let c = 0; c <= repeats[2]; c += 1) {
        if (a < repeats[0]) edges.push([gridPoint(a, b, c), gridPoint(a + 1, b, c)]);
        if (b < repeats[1]) edges.push([gridPoint(a, b, c), gridPoint(a, b + 1, c)]);
        if (c < repeats[2]) edges.push([gridPoint(a, b, c), gridPoint(a, b, c + 1)]);
      }
    }
  }

  const distances: { start: number; end: number; distance: number }[] = [];
  for (let start = 0; start < atoms.length; start += 1) {
    for (let end = start + 1; end < atoms.length; end += 1) {
      const distance = new THREE.Vector3(...atoms[start].position).distanceTo(
        new THREE.Vector3(...atoms[end].position),
      );
      if (distance > 0.08) distances.push({ start, end, distance });
    }
  }
  const nearestDistance = Math.min(...distances.map((item) => item.distance));
  const activeCutoff = bondCutoff > 0 ? bondCutoff * scale : nearestDistance * 1.12;
  const bonds = distances
    .filter((item) => item.distance <= activeCutoff)
    .slice(0, 280)
    .map((item) => [atoms[item.start].position, atoms[item.end].position] as [Point, Point]);

  return { atoms, bonds, edges };
}

function Bond({ start, end }: { start: Point; end: Point }) {
  const { midpoint, length, quaternion } = useMemo(() => {
    const from = new THREE.Vector3(...start);
    const to = new THREE.Vector3(...end);
    const direction = to.clone().sub(from);
    return {
      midpoint: from.clone().add(to).multiplyScalar(0.5),
      length: direction.length(),
      quaternion: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      ),
    };
  }, [start, end]);

  return (
    <mesh position={midpoint} quaternion={quaternion}>
      <cylinderGeometry args={[0.027, 0.027, length, 12]} />
      <meshStandardMaterial color="#8a94a6" roughness={0.65} metalness={0.05} />
    </mesh>
  );
}

function CrystalScene({
  composition,
  structure,
  lattice,
  customAtoms,
  replication,
  atomScale,
  bondCutoff,
  showBonds,
  showCell,
}: {
  composition: string;
  structure: CrystalStructure;
  lattice: LatticeParameters;
  customAtoms?: CustomAtom[];
  replication: [number, number, number];
  atomScale: number;
  bondCutoff: number;
  showBonds: boolean;
  showCell: boolean;
}) {
  const model = useMemo(
    () => createModel(composition, structure, lattice, customAtoms, replication, atomScale, bondCutoff),
    [composition, structure, lattice, customAtoms, replication, atomScale, bondCutoff],
  );

  return (
    <group rotation={[0.08, -0.28, 0.03]}>
      {showCell && model.edges.map(([start, end], index) => (
        <Line
          key={`edge-${index}`}
          points={[start, end]}
          color="#aeb6c5"
          lineWidth={0.72}
          transparent
          opacity={0.78}
        />
      ))}
      {showBonds && model.bonds.map(([start, end], index) => (
        <Bond key={`bond-${index}`} start={start} end={end} />
      ))}
      {model.atoms.map((atom, index) => (
        <mesh key={`${atom.species}-${index}`} position={atom.position}>
          <sphereGeometry args={[atom.radius, 30, 30]} />
          <meshStandardMaterial
            color={getElementStyle(atom.species).color}
            roughness={0.28}
            metalness={0.12}
          />
        </mesh>
      ))}
    </group>
  );
}

function formatLength(value: number) {
  return validLength(value, 0).toFixed(2);
}

export function CrystalViewer({
  className,
  compact = false,
  material = 'Silicon',
  composition = 'Si',
  structure,
  lattice,
  customAtoms,
  replication = [1, 1, 1],
  showBonds = true,
  showCell = true,
  atomScale = 1,
  bondCutoff = 0,
  autoRotate = true,
}: {
  className?: string;
  compact?: boolean;
  material?: string;
  composition?: string;
  structure?: CrystalStructure;
  lattice?: LatticeParameters;
  customAtoms?: CustomAtom[];
  replication?: [number, number, number];
  showBonds?: boolean;
  showCell?: boolean;
  atomScale?: number;
  bondCutoff?: number;
  autoRotate?: boolean;
}) {
  const eventSource = useRef<HTMLDivElement>(null);
  const defaults = defaultsByComposition[composition] ?? defaultsByComposition.Si;
  const activeStructure = structure ?? defaults.structure;
  const activeLattice = lattice ?? defaults.lattice;
  const species = Array.from(
    new Set(
      createFractionalSites(composition, activeStructure, customAtoms).map(
        (atom) => atom.species,
      ),
    ),
  );

  return (
    <div
      ref={eventSource}
      className={cn(
        'relative isolate min-h-[340px] overflow-hidden rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_50%_45%,#ffffff_0%,#f5f7fb_72%)]',
        compact && 'min-h-[280px]',
        className,
      )}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Interactive structure
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-700">
            {material} · {activeStructure.toLowerCase()}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {species.map((item) => (
              <span key={item} className="flex items-center gap-1 font-mono text-[10px] font-semibold text-slate-500">
                <i
                  className="h-2 w-2 rounded-full shadow-sm"
                  style={{ backgroundColor: getElementStyle(item).color }}
                />
                {item}
              </span>
            ))}
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-white/70 bg-white/80 px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-500 shadow-sm backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          LIVE 3D
        </span>
      </div>

      <Canvas
        camera={{ position: [3.8, 3.3, 4.4], fov: 36 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true }}
        eventSource={eventSource as React.RefObject<HTMLElement>}
        eventPrefix="client"
      >
        <ambientLight intensity={1.6} />
        <directionalLight position={[4, 5, 5]} intensity={2.4} color="#ffffff" />
        <directionalLight position={[-3, -1, 2]} intensity={1.1} color="#cdd4ff" />
        <CrystalScene
          composition={composition}
          structure={activeStructure}
          lattice={activeLattice}
          customAtoms={customAtoms}
          replication={replication}
          atomScale={atomScale}
          bondCutoff={bondCutoff}
          showBonds={showBonds}
          showCell={showCell}
        />
        <OrbitControls
          enablePan={false}
          minDistance={3.2}
          maxDistance={8}
          autoRotate={!compact && autoRotate}
          autoRotateSpeed={0.55}
        />
      </Canvas>

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-xl border border-white/80 bg-white/80 px-3 py-2 text-[11px] font-medium text-slate-500 shadow-sm backdrop-blur">
        <MousePointer2 className="h-3 w-3" /> Drag to rotate
        <span className="h-3 w-px bg-slate-200" />
        <Maximize2 className="h-3 w-3" /> Scroll to zoom
      </div>
      <div className="pointer-events-none absolute bottom-4 right-4 z-10 flex items-end gap-1 font-mono text-[10px] font-bold text-slate-400">
        <Rotate3D className="h-3.5 w-3.5" />
        {replication[0]}×{replication[1]}×{replication[2]} · a {formatLength(activeLattice.a)} · b {formatLength(activeLattice.b)} · c {formatLength(activeLattice.c)} Å
      </div>
    </div>
  );
}
