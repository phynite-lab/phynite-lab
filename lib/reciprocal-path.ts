import { latticeFromCellVectors, type CellVectors } from './crystal-cell.ts';

export type ReciprocalPathMode = 'automatic' | 'custom';

export const LEGACY_AUTOMATIC_K_PATH = 'Γ — X — W — K — Γ — L';

export type CrystalLatticeSystem =
  | 'hexagonal'
  | 'cubic-fcc'
  | 'cubic-bcc'
  | 'cubic-sc'
  | 'tetragonal'
  | 'orthorhombic'
  | 'rhombohedral'
  | 'monoclinic'
  | 'triclinic';

export type HighSymmetryPoint = {
  label: string;
  coords: [number, number, number];
};

export const LATTICE_PATH_DATA: Record<
  CrystalLatticeSystem,
  {
    displayName: string;
    defaultPath: string;
    points: Record<string, [number, number, number]>;
    chips: string[];
  }
> = {
  hexagonal: {
    displayName: 'Hexagonal',
    defaultPath: 'Γ — M — K — Γ — A — L — H — A',
    points: {
      'Γ': [0, 0, 0],
      M: [0.5, 0, 0],
      K: [1 / 3, 1 / 3, 0],
      A: [0, 0, 0.5],
      L: [0.5, 0, 0.5],
      H: [1 / 3, 1 / 3, 0.5],
    },
    chips: ['Γ', 'M', 'K', 'A', 'L', 'H'],
  },
  'cubic-fcc': {
    displayName: 'Cubic FCC',
    defaultPath: 'Γ — X — W — K — Γ — L',
    points: {
      'Γ': [0, 0, 0],
      X: [0.5, 0, 0.5],
      W: [0.5, 0.25, 0.75],
      K: [0.375, 0.375, 0.75],
      L: [0.5, 0.5, 0.5],
      U: [0.625, 0.25, 0.625],
    },
    chips: ['Γ', 'X', 'W', 'K', 'L', 'U'],
  },
  'cubic-bcc': {
    displayName: 'Cubic BCC',
    defaultPath: 'Γ — H — N — Γ — P — H',
    points: {
      'Γ': [0, 0, 0],
      H: [0.5, -0.5, 0.5],
      N: [0, 0.5, 0],
      P: [0.25, 0.25, 0.25],
    },
    chips: ['Γ', 'H', 'N', 'P'],
  },
  'cubic-sc': {
    displayName: 'Simple Cubic',
    defaultPath: 'Γ — X — M — Γ — R — X',
    points: {
      'Γ': [0, 0, 0],
      X: [0, 0.5, 0],
      M: [0.5, 0.5, 0],
      R: [0.5, 0.5, 0.5],
    },
    chips: ['Γ', 'X', 'M', 'R'],
  },
  tetragonal: {
    displayName: 'Tetragonal',
    defaultPath: 'Γ — X — M — Γ — Z — R — A — Z',
    points: {
      'Γ': [0, 0, 0],
      X: [0, 0.5, 0],
      M: [0.5, 0.5, 0],
      Z: [0, 0, 0.5],
      R: [0, 0.5, 0.5],
      A: [0.5, 0.5, 0.5],
    },
    chips: ['Γ', 'X', 'M', 'Z', 'R', 'A'],
  },
  orthorhombic: {
    displayName: 'Orthorhombic',
    defaultPath: 'Γ — X — S — Y — Γ — Z — U — R — T — Z',
    points: {
      'Γ': [0, 0, 0],
      X: [0.5, 0, 0],
      S: [0.5, 0.5, 0],
      Y: [0, 0.5, 0],
      Z: [0, 0, 0.5],
      U: [0.5, 0, 0.5],
      R: [0.5, 0.5, 0.5],
      T: [0, 0.5, 0.5],
    },
    chips: ['Γ', 'X', 'S', 'Y', 'Z', 'U', 'R', 'T'],
  },
  rhombohedral: {
    displayName: 'Rhombohedral',
    defaultPath: 'Γ — L — T — Γ',
    points: {
      'Γ': [0, 0, 0],
      L: [0.5, 0, 0],
      T: [0.5, 0.5, 0.5],
    },
    chips: ['Γ', 'L', 'T'],
  },
  monoclinic: {
    displayName: 'Monoclinic',
    defaultPath: 'Γ — Y — Z — Γ',
    points: {
      'Γ': [0, 0, 0],
      Y: [0, 0.5, 0],
      Z: [0, 0, 0.5],
    },
    chips: ['Γ', 'Y', 'Z'],
  },
  triclinic: {
    displayName: 'Triclinic',
    defaultPath: 'Γ — X — Y — Z — Γ',
    points: {
      'Γ': [0, 0, 0],
      X: [0.5, 0, 0],
      Y: [0, 0.5, 0],
      Z: [0, 0, 0.5],
    },
    chips: ['Γ', 'X', 'Y', 'Z'],
  },
};

export function detectLatticeSystem(
  cellVectors?: Array<[number, number, number]> | CellVectors | null,
  spaceGroup?: string | null,
): CrystalLatticeSystem {
  if (spaceGroup) {
    const cleanSg = spaceGroup.trim();
    const upper = cleanSg.toUpperCase();
    if (upper.startsWith('P6') || upper.startsWith('P-6')) return 'hexagonal';
    if (upper.startsWith('FM') || upper.startsWith('FD')) return 'cubic-fcc';
    if (upper.startsWith('IM') || upper.startsWith('IA')) return 'cubic-bcc';
    if (upper.startsWith('PM-3') || upper.startsWith('PN-3')) return 'cubic-sc';
    if (upper.startsWith('P4') || upper.startsWith('I4')) return 'tetragonal';
    if (upper.startsWith('PNMA') || upper.startsWith('PBNM') || upper.startsWith('CMCM')) return 'orthorhombic';
    if (upper.startsWith('R3') || upper.startsWith('R-3')) return 'rhombohedral';

    const numMatch = cleanSg.match(/(?:[·:]|\bno\.?|\bnumber\b)\s*([1-9]\d{0,2})\b/i) || cleanSg.match(/\b([1-9]\d{0,2})\s*$/);
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      if (num >= 1 && num <= 2) return 'triclinic';
      if (num >= 3 && num <= 15) return 'monoclinic';
      if (num >= 16 && num <= 74) return 'orthorhombic';
      if (num >= 75 && num <= 142) return 'tetragonal';
      if (num >= 143 && num <= 167) return 'rhombohedral';
      if (num >= 168 && num <= 194) return 'hexagonal';
      if (num >= 195 && num <= 230) {
        if (/^[Ff]/.test(cleanSg) || cleanSg.includes('Fd') || cleanSg.includes('Fm')) return 'cubic-fcc';
        if (/^[Ii]/.test(cleanSg) || cleanSg.includes('Im') || cleanSg.includes('Ia')) return 'cubic-bcc';
        return 'cubic-sc';
      }
    }
  }

  if (!cellVectors || cellVectors.length < 3) return 'cubic-fcc';

  try {
    const { a, b, c, alpha, beta, gamma } = latticeFromCellVectors(cellVectors as CellVectors);
    const eq = (x: number, y: number, tol = 0.05) => Math.abs(x - y) / Math.max(x, y, 1e-6) < tol;
    const eqAngle = (x: number, y: number, tolDeg = 2.5) => Math.abs(x - y) < tolDeg;

    // Hexagonal: a = b != c, alpha = beta = 90, gamma = 120 (or 60)
    if (eq(a, b) && eqAngle(alpha, 90) && eqAngle(beta, 90) && (eqAngle(gamma, 120) || eqAngle(gamma, 60))) {
      return 'hexagonal';
    }
    // Tetragonal: a = b != c, alpha = beta = gamma = 90
    if (eq(a, b) && !eq(a, c) && eqAngle(alpha, 90) && eqAngle(beta, 90) && eqAngle(gamma, 90)) {
      return 'tetragonal';
    }
    // Cubic: a = b = c, alpha = beta = gamma = 90
    if (eq(a, b) && eq(b, c) && eqAngle(alpha, 90) && eqAngle(beta, 90) && eqAngle(gamma, 90)) {
      return 'cubic-fcc';
    }
    // Primitive FCC: a = b = c, alpha = beta = gamma = 60
    if (eq(a, b) && eq(b, c) && eqAngle(alpha, 60) && eqAngle(beta, 60) && eqAngle(gamma, 60)) {
      return 'cubic-fcc';
    }
    // Primitive BCC: a = b = c, alpha = beta = gamma ≈ 109.47
    if (eq(a, b) && eq(b, c) && eqAngle(alpha, 109.47, 4) && eqAngle(beta, 109.47, 4) && eqAngle(gamma, 109.47, 4)) {
      return 'cubic-bcc';
    }
    // Rhombohedral: a = b = c, alpha = beta = gamma != 90
    if (eq(a, b) && eq(b, c) && eqAngle(alpha, beta) && eqAngle(beta, gamma) && !eqAngle(alpha, 90)) {
      return 'rhombohedral';
    }
    // Orthorhombic: a != b != c, alpha = beta = gamma = 90
    if (eqAngle(alpha, 90) && eqAngle(beta, 90) && eqAngle(gamma, 90)) {
      return 'orthorhombic';
    }
    // Monoclinic: two angles = 90, one != 90
    if (
      (eqAngle(alpha, 90) && eqAngle(gamma, 90) && !eqAngle(beta, 90)) ||
      (eqAngle(alpha, 90) && eqAngle(beta, 90) && !eqAngle(gamma, 90)) ||
      (eqAngle(beta, 90) && eqAngle(gamma, 90) && !eqAngle(alpha, 90))
    ) {
      return 'monoclinic';
    }
  } catch {
    // If cell vectors are malformed, fall back to default
  }

  return 'cubic-fcc';
}

export function defaultKPathForMaterial(material?: {
  cellVectors?: Array<[number, number, number]>;
  spaceGroup?: string;
} | null): string {
  const system = detectLatticeSystem(material?.cellVectors, material?.spaceGroup);
  return LATTICE_PATH_DATA[system].defaultPath;
}

export function highSymmetryChipsForMaterial(material?: {
  cellVectors?: Array<[number, number, number]>;
  spaceGroup?: string;
} | null): string[] {
  const system = detectLatticeSystem(material?.cellVectors, material?.spaceGroup);
  return LATTICE_PATH_DATA[system].chips;
}

export function latticeSystemInfoForMaterial(material?: {
  cellVectors?: Array<[number, number, number]>;
  spaceGroup?: string;
} | null): {
  system: CrystalLatticeSystem;
  displayName: string;
  defaultPath: string;
  chips: string[];
} {
  const system = detectLatticeSystem(material?.cellVectors, material?.spaceGroup);
  const data = LATTICE_PATH_DATA[system];
  return {
    system,
    displayName: data.displayName,
    defaultPath: data.defaultPath,
    chips: data.chips,
  };
}

export function formatQeKPointsCrystalB(
  draft: { kPath?: string; kPathMode?: ReciprocalPathMode; kPathPoints: number },
  material?: { cellVectors?: Array<[number, number, number]>; spaceGroup?: string } | null,
): string {
  const system = detectLatticeSystem(material?.cellVectors, material?.spaceGroup);
  const data = LATTICE_PATH_DATA[system];
  const mode = resolveReciprocalPathMode({ kPath: draft.kPath ?? '', kPathMode: draft.kPathMode });

  const pathString = mode === 'automatic'
    ? data.defaultPath
    : (draft.kPath?.trim() || data.defaultPath);

  const rawLabels = pathString
    .replace(/\u03b3/gi, 'Γ')
    .split(/\s*(?:->|[—–→\-,;|])\s*/)
    .map((l) => l.trim())
    .filter(Boolean);

  const labels = rawLabels.length >= 2 ? rawLabels : data.defaultPath.split(/\s*(?:->|[—–→\-,;|])\s*/);

  const getCoords = (label: string): [number, number, number] => {
    const clean = label.toUpperCase();
    if (clean === 'Γ' || clean === 'GAMMA') return [0, 0, 0];
    if (data.points[label]) return data.points[label];
    for (const [k, v] of Object.entries(data.points)) {
      if (k.toUpperCase() === clean) return v;
    }
    for (const sys of Object.values(LATTICE_PATH_DATA)) {
      for (const [k, v] of Object.entries(sys.points)) {
        if (k.toUpperCase() === clean) return v;
      }
    }
    return [0, 0, 0];
  };

  const lines: string[] = [];
  const count = labels.length;
  for (let i = 0; i < count; i++) {
    const label = labels[i];
    const coords = getCoords(label);
    const weight = i === count - 1 ? 1 : draft.kPathPoints;
    lines.push(`${coords[0].toFixed(4)} ${coords[1].toFixed(4)} ${coords[2].toFixed(4)} ${weight} ! ${label}`);
  }

  return `K_POINTS crystal_b\n${lines.length}\n${lines.join('\n')}`;
}

function normalizePath(value: string) {
  return value
    .replace(/\u03b3/gi, 'Γ')
    .replace(/\s*(?:->|[—–→\-,;|])\s*/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/**
 * Drafts created before kPathMode existed used a fixed FCC-looking path as an
 * automatic-path placeholder. Preserve that migration while treating any
 * other saved path as an explicit user request.
 */
export function resolveReciprocalPathMode(draft: {
  kPath: string;
  kPathMode?: ReciprocalPathMode;
}): ReciprocalPathMode {
  if (draft.kPathMode) return draft.kPathMode;
  return normalizePath(draft.kPath) === normalizePath(LEGACY_AUTOMATIC_K_PATH)
    ? 'automatic'
    : 'custom';
}

export function requestedReciprocalPath(draft: {
  kPath: string;
  kPathMode?: ReciprocalPathMode;
}) {
  if (resolveReciprocalPathMode(draft) !== 'custom') return undefined;
  const path = draft.kPath.trim();
  return path || undefined;
}

export function reciprocalPathSubmission(
  calculationType: string,
  draft: { kPath: string; kPathMode?: ReciprocalPathMode },
  rawInput: string,
): { autoKPath: boolean; requestedKPath?: string } {
  const hasRawInput = Boolean(rawInput.trim());
  const requestedKPath = calculationType === 'Band structure' && !hasRawInput
    ? requestedReciprocalPath(draft)
    : undefined;
  return {
    autoKPath: !hasRawInput && !requestedKPath,
    ...(requestedKPath ? { requestedKPath } : {}),
  };
}
