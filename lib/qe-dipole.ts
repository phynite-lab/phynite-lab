import type { JobDraft, MaterialContext } from '../components/JobComposer.tsx';

/** Geometry is a placement aid, not evidence that electron density vanishes. */
export function resolveSlabDipole(draft: JobDraft, material: MaterialContext) {
  if (!draft.dipoleCorrection) return null;
  if (!material?.atoms.length) throw new Error('Dipole correction needs an explicit slab structure.');
  if (draft.assumeIsolated !== 'none') throw new Error('Choose either slab dipole correction or assume_isolated; do not combine electrostatic boundary methods.');
  const [a, b, c] = material.cellVectors;
  const length = Math.hypot(...c);
  const dot = (u: number[], v: number[]) => u.reduce((sum, value, i) => sum + value * v[i], 0);
  if (!Number.isFinite(length) || length <= 0 || Math.abs(dot(a, c)) > 1e-8 * Math.hypot(...a) * length || Math.abs(dot(b, c)) > 1e-8 * Math.hypot(...b) * length) throw new Error('Dipole correction requires the third lattice vector perpendicular to the slab plane. Reorient the cell first.');
  const z = material.atoms.map(atom => ((atom.z % 1) + 1) % 1).sort((x, y) => x - y);
  if (!z.every(Number.isFinite)) throw new Error('Slab positions must be finite fractional coordinates.');
  const gaps = z.map((start, i) => ({ start, width: (z[i + 1] ?? z[0] + 1) - start }));
  const vacuum = gaps.reduce((best, gap) => gap.width > best.width ? gap : best);
  // Keep both changes of slope at least 2 Å from every nuclear plane.
  const clearance = 2 / length;
  if (vacuum.width * length < 6) throw new Error('No vacuum gap of at least 6 Å was found along the third lattice vector. Add vacuum before enabling dipole correction.');
  const automatic = draft.dipolePlacement !== 'manual';
  const width = automatic ? Math.min(.1, (vacuum.width - 2 * clearance) / 2) : draft.dipoleRegion;
  const start = automatic ? ((vacuum.start + vacuum.width / 2 - width! / 2) % 1 + 1) % 1 : draft.dipolePosition;
  const amplitude = draft.electricFieldAmplitude ?? 0;
  if (start === undefined || width === undefined || !(start > 0 && start < 1 && width > 0 && width < 1) || ![start, width, amplitude].every(Number.isFinite)) throw new Error('Use 0 < emaxpos, eopreg < 1 and a finite electric field in Hartree atomic units.');
  // A wrapped interval is allowed, but the entire interval must fit one empty gap.
  const relative = ((start - vacuum.start) % 1 + 1) % 1;
  if (relative < clearance - 1e-10 || relative + width > vacuum.width - clearance + 1e-10) throw new Error('The entire dipole correction region must lie inside the vacuum, at least 2 Å from atomic planes.');
  return { direction: 3, position: start, region: width, amplitude, vacuumGapAngstrom: vacuum.width * length, placement: automatic ? 'geometry-assisted' : 'manual', densityCheckRequired: true };
}
