/** Fixed public endpoints and provider capabilities, checked against live OPTIMADE services. */
export type CrystalSource = 'cod' | 'materials-project' | 'oqmd' | 'aflow' | 'jarvis' | 'alexandria' | 'nomad';
export type CrystalSourceLabel = 'Crystallography Open Database' | 'Materials Project' | 'OQMD' | 'AFLOW' | 'JARVIS-DFT' | 'Alexandria PBE' | 'NOMAD';
export type CrystalSort = 'default' | 'sites' | '-sites' | 'band-gap' | '-band-gap' | 'energy-above-hull';
export type CrystalFilters = { spaceGroup?: number; minSites?: number; maxSites?: number; minBandGap?: number; maxBandGap?: number; maxEnergyAboveHull?: number };
export type CrystalSearchOptions = { source?: CrystalSource | 'auto'; limit?: number; offset?: number; filters?: CrystalFilters; sort?: CrystalSort };
export type CrystalPage = { offset: number; limit: number; total: number | null; hasMore: boolean; nextOffset: number | null };
export const crystalElements = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' '));
export class CrystalDatabaseError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.name = 'CrystalDatabaseError'; this.status = status; this.code = code; }
}
type Provider = { label: CrystalSourceLabel; homepage: string; endpoint?: string; prefix?: string; paging: 'offset' | 'number' | 'none'; filters: Array<keyof CrystalFilters>; sorts: CrystalSort[]; gap?: string; hull?: string; spaceGroup?: string; density?: string; symbol?: string };
const ranges: Array<keyof CrystalFilters> = ['spaceGroup', 'minSites', 'maxSites', 'minBandGap', 'maxBandGap', 'maxEnergyAboveHull'];
export const crystalSources: Record<CrystalSource, Provider> = {
  cod: { label: 'Crystallography Open Database', homepage: 'https://www.crystallography.net/cod/', paging: 'offset', filters: [], sorts: ['default'] },
  'materials-project': { label: 'Materials Project', homepage: 'https://materialsproject.org/about/terms', paging: 'offset', filters: ranges, sorts: ['default', 'sites', '-sites', 'band-gap', '-band-gap', 'energy-above-hull'] },
  oqmd: { label: 'OQMD', homepage: 'https://oqmd.org/', endpoint: 'https://oqmd.org/optimade/v1/structures', prefix: 'oqmd', paging: 'offset', filters: ranges, sorts: ['default', 'energy-above-hull'], gap: '_oqmd_band_gap', hull: '_oqmd_stability', spaceGroup: 'space_group_it_number' },
  aflow: { label: 'AFLOW', homepage: 'https://aflow.org/', endpoint: 'https://aflow.org/API/optimade/v1/structures', prefix: 'aflow', paging: 'number', filters: ['spaceGroup', 'minSites', 'maxSites', 'minBandGap', 'maxBandGap'], sorts: ['default'], gap: '_aflow_egap', spaceGroup: 'space_group_it_number', density: '_aflow_density' },
  jarvis: { label: 'JARVIS-DFT', homepage: 'https://jarvis.nist.gov/', endpoint: 'https://jarvis.nist.gov/optimade/jarvisdft/v1/structures/', prefix: 'jarvis', paging: 'none', filters: ['minSites', 'maxSites'], sorts: ['default'], gap: '_jarvis_optb88vdw_bandgap', hull: '_jarvis_ehull', spaceGroup: '_jarvis_spg_number', symbol: '_jarvis_spg_symbol', density: '_jarvis_density' },
  alexandria: { label: 'Alexandria PBE', homepage: 'https://alexandria.icams.rub.de/', endpoint: 'https://alexandria.icams.rub.de/pbe/v1/structures', prefix: 'alexandria', paging: 'offset', filters: ranges, sorts: ['default', 'sites', '-sites', 'band-gap', '-band-gap', 'energy-above-hull'], gap: '_alexandria_band_gap', hull: '_alexandria_hull_distance', spaceGroup: '_alexandria_space_group' },
  nomad: { label: 'NOMAD', homepage: 'https://nomad-lab.eu/', endpoint: 'https://nomad-lab.eu/prod/v1/optimade/v1/structures', prefix: 'nmd', paging: 'offset', filters: ['spaceGroup', 'minSites', 'maxSites'], sorts: ['default', 'sites', '-sites'], spaceGroup: '_nmd_results_material_symmetry_space_group_number', symbol: '_nmd_results_material_symmetry_space_group_symbol' },
};
export const crystalSourceIds = Object.keys(crystalSources) as CrystalSource[];
type FilterableMaterial = { spaceGroupNumber?: number; numSites: number; bandGap?: number; energyAboveHull?: number };
export function crystalMatchesFilters(material: FilterableMaterial, filters: CrystalFilters) {
  const fields: Record<keyof CrystalFilters, number | undefined> = { spaceGroup: material.spaceGroupNumber, minSites: material.numSites, maxSites: material.numSites, minBandGap: material.bandGap, maxBandGap: material.bandGap, maxEnergyAboveHull: material.energyAboveHull };
  return Object.entries(filters).every(([key, limit]) => {
    if (limit === undefined) return true;
    const value = fields[key as keyof CrystalFilters];
    return value !== undefined && (key === 'spaceGroup' ? value === limit : key.startsWith('min') ? value >= limit : value <= limit);
  });
}
export function validateCrystalOrder(materials: FilterableMaterial[], sort: CrystalSort = 'default') {
  if (sort === 'default') return;
  const property = sort.endsWith('sites') ? 'numSites' : sort.endsWith('band-gap') ? 'bandGap' : 'energyAboveHull';
  const values = materials.map(material => material[property]).filter((value): value is number => value !== undefined);
  const direction = sort.startsWith('-') ? -1 : 1;
  if (values.some((value, index) => index > 0 && direction * (value - values[index - 1]) < -1e-10)) throw new CrystalDatabaseError(502, 'CRYSTAL_SORT_NOT_HONORED', 'The source did not honor the requested sort. Choose Source order or another database.');
}
export function validateCrystalOptions(source: CrystalSource, options: CrystalSearchOptions) {
  const provider = crystalSources[source], filters = options.filters ?? {}, sort = options.sort ?? 'default';
  if (!provider) throw new CrystalDatabaseError(400, 'CRYSTAL_SOURCE_INVALID', 'Choose a supported crystal database.');
  const limit = options.limit ?? 12, offset = options.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30 || !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000) throw new CrystalDatabaseError(400, 'CRYSTAL_PAGE_INVALID', 'Use 1–30 records per page and a page offset between 0 and 10,000.');
  if (offset && provider.paging === 'none') throw new CrystalDatabaseError(400, 'CRYSTAL_PAGE_UNSUPPORTED', 'This source does not provide reliable paging. Narrow the query instead.');
  if (!provider.sorts.includes(sort)) throw new CrystalDatabaseError(400, 'CRYSTAL_SORT_UNSUPPORTED', 'The selected source does not support that sort order.');
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    if (!provider.filters.includes(key as keyof CrystalFilters)) throw new CrystalDatabaseError(400, 'CRYSTAL_FILTER_UNSUPPORTED', `The selected source does not support the ${key} filter.`);
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 100_000 || (['spaceGroup', 'minSites', 'maxSites'].includes(key) && (!Number.isSafeInteger(value) || value < 1)) || (key === 'spaceGroup' && value > 230)) throw new CrystalDatabaseError(400, 'CRYSTAL_FILTER_INVALID', 'Use finite property limits, positive integer site counts, and space groups 1–230.');
  }
  if ((filters.minSites ?? 0) > (filters.maxSites ?? Infinity) || (filters.minBandGap ?? 0) > (filters.maxBandGap ?? Infinity)) throw new CrystalDatabaseError(400, 'CRYSTAL_FILTER_INVALID', 'A minimum filter value cannot exceed its maximum.');
  return { limit, offset, filters, sort, provider };
}
export const crystalDigest = async (content: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))), byte => byte.toString(16).padStart(2, '0')).join('');
export function crystalSearchParameters(options: CrystalSearchOptions) {
  const result = new URLSearchParams();
  if (options.offset) result.set('offset', String(options.offset));
  if (options.sort && options.sort !== 'default') result.set('sort', options.sort);
  for (const [key, value] of Object.entries(options.filters ?? {})) if (value !== undefined) result.set(key, String(value));
  return result;
}
export function crystalOptionsFromParameters(parameters: URLSearchParams): CrystalSearchOptions {
  const filters: CrystalFilters = {};
  for (const key of ranges) if (parameters.has(key)) filters[key] = Number(parameters.get(key));
  return { source: (parameters.get('source') ?? 'auto') as CrystalSource | 'auto', limit: parameters.has('limit') ? Number(parameters.get('limit')) : 12, offset: parameters.has('offset') ? Number(parameters.get('offset')) : 0, sort: (parameters.get('sort') ?? 'default') as CrystalSort, filters };
}
