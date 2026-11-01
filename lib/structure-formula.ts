import type { CustomAtom } from '../components/CrystalViewer.tsx';
/** Reduced integer composition; fractional occupancies retain their supplied decimal values. */
export function structureFormula(atoms: Array<Pick<CustomAtom, 'species' | 'siteSpecies' | 'occupancy'>>): string | null {
  const counts = new Map<string, number>();
  for (const atom of atoms) for (const site of atom.siteSpecies?.length ? atom.siteSpecies : [{ element: atom.species, occupancy: atom.occupancy ?? 1 }]) {
    if (!site.element || !Number.isFinite(site.occupancy) || site.occupancy <= 0) return null;
    counts.set(site.element, (counts.get(site.element) ?? 0) + site.occupancy);
  }
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const values = [...counts.values()];
  const divisor = values.every(Number.isSafeInteger) ? values.reduce(gcd, 0) || 1 : 1;
  return [...counts].map(([element, count]) => `${element}${count / divisor === 1 ? '' : count / divisor}`).join('') || null;
}
