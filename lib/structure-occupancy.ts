type Site = { occupancy?: number; siteSpecies?: Array<{ occupancy: number }> };

export function orderedStructureIssue(atoms: Site[]): string | null {
  return atoms.some((atom) => (atom.occupancy !== undefined && Math.abs(atom.occupancy - 1) > 1e-8) || (atom.siteSpecies && (atom.siteSpecies.length !== 1 || Math.abs(atom.siteSpecies[0].occupancy - 1) > 1e-8)))
    ? 'This structure has partial or mixed site occupancies. Build an explicit ordered configuration before exporting atomic coordinates or running Quantum ESPRESSO; CIF preserves the occupancies.'
    : null;
}
