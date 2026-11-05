import type { CustomAtom } from '../components/CrystalViewer.tsx';
import { cartesianToFractionalWithVectors, latticeFromCellVectors, type CellVector, type CellVectors } from './crystal-cell.ts';
import type { CrystalDatabaseMaterial, CrystalDatabaseResult } from './crystal-database.ts';
import { CrystalDatabaseError, crystalDigest, crystalElements as elements, crystalMatchesFilters, crystalSources, validateCrystalOptions, validateCrystalOrder, type CrystalSource, type CrystalSearchOptions } from './crystal-database-options.ts';
import { orderedStructureIssue } from './structure-occupancy.ts';

const object = (raw: unknown): Record<string, unknown> => raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
const text = (raw: unknown) => typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '';
const finite = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw);
const fields = ['chemical_formula_reduced', 'chemical_formula_descriptive', 'elements', 'nsites', 'lattice_vectors', 'cartesian_site_positions', 'species_at_sites', 'species', 'dimension_types', 'structure_features', 'last_modified'];
const wrap = (value: number) => ((value % 1) + 1) % 1;
export function optimadeId(query: string) { const match = /^(oqmd|aflow|jarvis|alexandria|nomad)\/([A-Za-z0-9_:.-]{1,120})$/.exec(query); return match && !['.', '..'].includes(match[2]) ? match : null; }
function formula(query: string) {
  if (!/^(?:[A-Z][a-z]?(?:[1-9][0-9]*)?)+$/.test(query)) throw new CrystalDatabaseError(400, 'CRYSTAL_QUERY_INVALID', 'Use a simple integer formula, an element list such as Si-O, or an exact source ID.');
  const counts = new Map<string, number>();
  for (const [, element, amount] of query.matchAll(/([A-Z][a-z]?)([0-9]*)/g)) {
    if (!elements.has(element)) throw new CrystalDatabaseError(400, 'CRYSTAL_QUERY_INVALID', 'Use valid periodic-table symbols.');
    const count = (counts.get(element) ?? 0) + Number(amount || 1);
    if (!Number.isSafeInteger(count)) throw new CrystalDatabaseError(400, 'CRYSTAL_QUERY_INVALID', 'Use a formula with exact, safely representable integer counts.');
    counts.set(element, count);
  }
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = [...counts.values()].reduce(gcd);
  return { symbols: [...counts.keys()].sort(), reduced: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, count]) => symbol + (count / divisor === 1 ? '' : count / divisor)).join('') };
}
export function optimadeParameters(query: string, source: CrystalSource, options: CrystalSearchOptions) {
  const { provider, filters, sort, limit, offset } = validateCrystalOptions(source, options);
  const identity = optimadeId(query), conditions: string[] = [], warnings: string[] = [];
  if (identity) {
    if (identity[1] !== source) throw new CrystalDatabaseError(400, 'CRYSTAL_SOURCE_INVALID', 'The source ID does not belong to the selected database.');
    conditions.push(`id=${JSON.stringify(identity[2])}`);
  } else {
    const list = query.split(/[-,\s]+/).filter(Boolean);
    if (list.length > 1 && list.every(item => elements.has(item))) {
      const symbols = [...new Set(list)].sort();
      conditions.push(`elements HAS ALL ${symbols.map(item => JSON.stringify(item)).join(',')}`);
      if (source === 'jarvis') warnings.push('JARVIS matches the listed elements and may also return compounds containing additional elements.');
      else conditions.push(`nelements=${symbols.length}`);
    } else {
      const parsed = formula(query);
      if (source === 'aflow') {
        if (parsed.symbols.length > 1) throw new CrystalDatabaseError(400, 'CRYSTAL_QUERY_UNSUPPORTED', 'AFLOW does not support exact formula matching. Use an element list such as Si-O, or an AFLOW source ID.');
        conditions.push(`elements HAS ALL ${JSON.stringify(parsed.symbols[0])}`, 'nelements=1');
      } else conditions.push(`chemical_formula_reduced=${JSON.stringify(parsed.reduced)}`);
    }
  }
  if (source === 'nomad' && !identity) conditions.push('nperiodic_dimensions>0');
  const properties: Record<string, string | undefined> = { spaceGroup: provider.spaceGroup, minSites: 'nsites', maxSites: 'nsites', minBandGap: provider.gap, maxBandGap: provider.gap, maxEnergyAboveHull: provider.hull };
  for (const [key, value] of Object.entries(filters)) if (value !== undefined) conditions.push(`${properties[key]}${key === 'spaceGroup' ? '=' : key.startsWith('min') ? '>=' : '<='}${value}`);
  const parameters = new URLSearchParams({ filter: conditions.join(' AND '), page_limit: String(source === 'jarvis' ? 20 : limit), response_fields: [...fields, provider.gap, provider.hull, provider.spaceGroup, provider.density, provider.symbol].filter((item): item is string => Boolean(item)).join(',') });
  if (offset) parameters.set(provider.paging === 'number' ? 'page_number' : 'page_offset', String(provider.paging === 'number' ? offset / limit + 1 : offset));
  if (provider.paging === 'number' && offset % limit) throw new CrystalDatabaseError(400, 'CRYSTAL_PAGE_INVALID', 'AFLOW page offsets must be a multiple of the page size.');
  const sortProperty = sort.endsWith('sites') ? 'nsites' : sort.endsWith('band-gap') ? provider.gap : provider.hull;
  if (sort !== 'default') parameters.set('sort', (sort.startsWith('-') ? '-' : '') + sortProperty);
  return { parameters, warnings };
}
/** OPTIMADE concentrations describe occupancy within each site, never bulk composition. */
export async function normalizeOptimade(raw: unknown, source: CrystalSource, retrievedAt: string): Promise<CrystalDatabaseMaterial> {
  const record = object(raw), attributes = object(record.attributes), provider = crystalSources[source], id = text(record.id);
  if (record.type !== 'structures' || !/^[A-Za-z0-9_:.-]{1,120}$/.test(id) || ['.', '..'].includes(id) || !provider.endpoint) throw new Error('The source record has no supported structure identity.');
  const vectors = attributes.lattice_vectors;
  if (!Array.isArray(vectors) || vectors.length !== 3 || vectors.some(row => !Array.isArray(row) || row.length !== 3 || !row.every(finite))) throw new Error('The source did not supply complete cell vectors.');
  const lattice = latticeFromCellVectors(vectors as CellVectors), periodic = attributes.dimension_types;
  if (!Array.isArray(periodic) || periodic.length !== 3 || periodic.some(item => item !== 0 && item !== 1)) throw new Error('The source did not supply valid periodicity.');
  lattice.periodic = periodic.map(item => item === 1) as [boolean, boolean, boolean];
  const positions = attributes.cartesian_site_positions, names = attributes.species_at_sites;
  if (!Number.isSafeInteger(attributes.nsites) || !Array.isArray(positions) || !positions.length || positions.length > 5000 || positions.length !== attributes.nsites || !Array.isArray(names) || names.length !== positions.length || !Array.isArray(attributes.species)) throw new Error('The source site count or coordinates are incomplete.');
  if (!Array.isArray(attributes.structure_features) || attributes.structure_features.some(feature => feature !== 'disorder')) throw new Error('Assemblies, implicit atoms and unsupported structure features cannot be imported.');
  const species = new Map<string, Array<{ element: string; species: string; occupancy: number }>>();
  for (const rawSpecies of attributes.species) {
    const entry = object(rawSpecies), symbols = entry.chemical_symbols, concentrations = entry.concentration, name = text(entry.name);
    if (!name || species.has(name) || !Array.isArray(symbols) || !Array.isArray(concentrations) || symbols.length !== concentrations.length || !symbols.length || concentrations.some(value => !finite(value) || value < 0 || value > 1) || Math.abs(concentrations.reduce((total, value) => total + value, 0) - 1) > 1e-6) throw new Error('The source reports invalid per-site occupancies; bulk composition fractions cannot replace site occupancies.');
    const sites = symbols.flatMap((symbol, index) => {
      if (symbol === 'vacancy' || concentrations[index] === 0) return [];
      if (!elements.has(symbol)) throw new Error('The source contains an unknown or implicit element.');
      return [{ element: symbol as string, species: symbol as string, occupancy: concentrations[index] as number }];
    });
    if (!sites.length) throw new Error('A source site has no atoms.');
    species.set(name, sites);
  }
  const materialId = `${source}/${id}`;
  const atoms = positions.map((position, index): CustomAtom => {
    if (!Array.isArray(position) || position.length !== 3 || !position.every(finite)) throw new Error('The source has invalid Cartesian positions.');
    const siteSpecies = species.get(names[index]);
    if (!siteSpecies) throw new Error('A site refers to an undefined species.');
    const coordinates = cartesianToFractionalWithVectors(position as CellVector, vectors as CellVectors).map((value, axis) => lattice.periodic![axis] ? wrap(value) : value);
    return { id: `${materialId}-site-${index + 1}`, species: siteSpecies[0].element, x: coordinates[0], y: coordinates[1], z: coordinates[2], occupancy: siteSpecies.reduce((total, item) => total + item.occupancy, 0), siteSpecies };
  });
  const formula = text(attributes.chemical_formula_reduced) || text(attributes.chemical_formula_descriptive);
  if (!formula) throw new Error('The source did not report a chemical formula.');
  const content = JSON.stringify(record), sourceSha256 = await crystalDigest(content), sourceUrl = provider.endpoint.replace(/\/$/, '') + '/' + encodeURIComponent(id), lastUpdated = text(attributes.last_modified) || null;
  if (lastUpdated && !Number.isFinite(Date.parse(lastUpdated))) throw new Error('The source modification timestamp is invalid.');
  const reported = (key: string | undefined) => key && finite(attributes[key]) && !(source === 'jarvis' && attributes[key] === -99999) ? attributes[key] as number : undefined;
  const bandGap = reported(provider.gap), energyAboveHull = reported(provider.hull), density = reported(provider.density), group = provider.spaceGroup ? Number(attributes[provider.spaceGroup] ?? NaN) : NaN;
  const warning = orderedStructureIssue(atoms), warnings = warning ? [warning] : [];
  if (density !== undefined && density <= 0) warnings.push('The source density is not positive and was omitted; no density was calculated or substituted.');
  return { source: provider.label, materialId, formula, lattice, atoms, numSites: atoms.length, spaceGroupSymbol: text(attributes.space_group_symbol_hermann_mauguin) || (provider.symbol ? text(attributes[provider.symbol]) : '') || 'unknown', ...(Number.isInteger(group) && group >= 1 && group <= 230 ? { spaceGroupNumber: group } : {}), crystalSystem: 'unknown', lastUpdated, sourceUrl,
    ...(bandGap === undefined ? {} : { bandGap }), ...(energyAboveHull === undefined ? {} : { energyAboveHull }), ...(density === undefined || density <= 0 ? {} : { density }),
    sourceData: { filename: `${source}-${id.replace(/[^A-Za-z0-9_.-]/g, '-')}.json`, format: 'optimade-json', content, sha256: sourceSha256 },
    provenance: { database: source, id: materialId, url: sourceUrl, retrievedAt, sourceUpdatedAt: lastUpdated, sourceFormat: 'optimade-json', sourceSha256, structureSha256: await crystalDigest(JSON.stringify({ lattice, atoms })), termsUrl: provider.homepage }, warnings };
}
export async function searchOptimade(query: string, source: CrystalSource, options: CrystalSearchOptions & { fetcher?: typeof fetch; signal?: AbortSignal }, retrieve: (url: URL, options: RequestInit, fetcher: typeof fetch, maximum: number) => Promise<string>): Promise<CrystalDatabaseResult> {
  const { limit, offset, provider } = validateCrystalOptions(source, options), { parameters, warnings } = optimadeParameters(query, source, options), retrievedAt = new Date().toISOString();
  const endpoint = new URL(provider.endpoint!); endpoint.search = parameters.toString();
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000);
  try {
    const payload = object(JSON.parse(await retrieve(endpoint, { signal, headers: { Accept: 'application/json', 'User-Agent': 'PhyniteLab (crystal structure lookup)' } }, options.fetcher ?? fetch, 5_000_000)));
    if (!Array.isArray(payload.data)) throw new CrystalDatabaseError(502, 'CRYSTAL_RESPONSE_INVALID', 'The source returned an unsupported structure response.');
    const meta = object(payload.meta), materials: CrystalDatabaseMaterial[] = [];
    const responseLimit = source === 'jarvis' ? 20 : limit;
    for (const raw of payload.data.slice(0, responseLimit)) {
      signal.throwIfAborted();
      try {
        const material = await normalizeOptimade(raw, source, retrievedAt);
        if (!crystalMatchesFilters(material, options.filters ?? {})) throw new Error('The source record does not meet the selected filters; its properties were not substituted.');
        materials.push(material);
      }
      catch (failure) { warnings.push(`${provider.label} ${text(object(raw).id)} was omitted: ${failure instanceof Error ? failure.message : 'invalid geometry'}`); }
    }
    if (source === 'jarvis') warnings.push('JARVIS returns a fixed first page of up to 20 records and does not reliably support paging or sorting. Narrow the query for other structures.');
    validateCrystalOrder(materials, options.sort);
    const total = Number.isSafeInteger(meta.data_returned) && (meta.data_returned as number) >= payload.data.length ? meta.data_returned as number : null;
    const hasMore = provider.paging !== 'none' && payload.data.length > 0 && (meta.more_data_available === true || (total !== null && offset + payload.data.length < total));
    return { materials, query, source: provider.label, retrievedAt, warnings: [...new Set(warnings)], pagination: { offset, limit: responseLimit, total, hasMore, nextOffset: hasMore ? offset + limit : null } };
  } catch (failure) {
    options.signal?.throwIfAborted();
    if (failure instanceof CrystalDatabaseError) throw failure;
    throw new CrystalDatabaseError(502, signal.aborted ? 'CRYSTAL_DATABASE_TIMEOUT' : 'CRYSTAL_DATABASE_UNAVAILABLE', signal.aborted ? 'The crystal database timed out. Retry or narrow the search.' : 'The selected crystal database is unavailable. Retry or choose another source.');
  }
}
