import type { CustomAtom } from '../components/CrystalViewer.tsx';
import { cellVectorsFromLattice, latticeFromCellVectors, type CellVectors, type LatticeParameters } from './crystal-cell.ts';
import { parseStructureText } from './structure-parsers.ts';
import { orderedStructureIssue } from './structure-occupancy.ts';
import { CrystalDatabaseError, crystalSources, crystalElements as symbols, crystalMatchesFilters, validateCrystalOrder, validateCrystalOptions, type CrystalSource, type CrystalSourceLabel, type CrystalSearchOptions, type CrystalPage } from './crystal-database-options.ts';
import { optimadeId, searchOptimade } from './crystal-database-optimade.ts';

export { CrystalDatabaseError } from './crystal-database-options.ts';
export type CrystalDatabaseSource = CrystalSource | 'auto';
export type CrystalDatabaseMaterial = {
  source: CrystalSourceLabel; materialId: string; formula: string;
  spaceGroupSymbol: string; spaceGroupNumber?: number; crystalSystem: string; numSites: number;
  bandGap?: number; energyAboveHull?: number; isStable?: boolean; density?: number; magneticOrdering?: string;
  theoretical?: boolean; lastUpdated: string | null; sourceUrl: string; lattice: LatticeParameters; atoms: CustomAtom[];
  sourceData: { filename: string; format: 'cif' | 'materials-project-json' | 'optimade-json'; content: string; sha256: string };
  provenance: { database: Exclude<CrystalDatabaseSource, 'auto'>; id: string; url: string; retrievedAt: string; sourceUpdatedAt: string | null; sourceFormat: 'cif' | 'materials-project-json' | 'optimade-json'; sourceSha256: string; structureSha256: string; termsUrl: string };
  geometryTransforms?: Array<Record<string, unknown>>;
  warnings: string[];
};
export type CrystalDatabaseResult = { materials: CrystalDatabaseMaterial[]; query: string; source: CrystalDatabaseMaterial['source']; retrievedAt: string; warnings: string[]; pagination?: CrystalPage };
const fields = 'material_id,formula_pretty,structure,symmetry,nsites,band_gap,energy_above_hull,is_stable,density,ordering,theoretical,last_updated';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const plain = (value: unknown, maximum = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum) : '';
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const digest = async (content: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))), byte => byte.toString(16).padStart(2, '0')).join('');

/** Only fixed endpoints are used; queries must be public material identifiers, never project text or URLs. */
export function crystalDatabaseQuery(raw: unknown) {
  if (typeof raw === 'string' && optimadeId(raw.trim()) && !/(?:api[_ -]?key|password|bearer|token|sk-[\w-]{12,})/i.test(raw)) return raw.trim();
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 80 || !/^[A-Za-z0-9*+\-., ()]+$/.test(raw.trim()) || /(?:api[_ -]?key|password|bearer|token|sk-[\w-]{12,})/i.test(raw)) throw new CrystalDatabaseError(400, 'CRYSTAL_QUERY_INVALID', 'Use a public formula, element symbols, one or two keywords, MP-ID, or cod-1234567 without credentials or private data.');
  if (/^cod-/i.test(raw.trim()) && !/^cod-\d{7}$/i.test(raw.trim())) throw new CrystalDatabaseError(400, 'CRYSTAL_QUERY_INVALID', 'A COD ID must contain exactly seven digits, for example cod-1526655.');
  return raw.trim();
}
export function codQueryParameters(query: string) {
  const parameters = new URLSearchParams({ format: 'json' }), id = query.match(/^(?:cod-)?(\d{7})$/i);
  if (id) { parameters.set('id', id[1]); return parameters; }
  const list = query.split(/[-,\s]+/).filter(Boolean);
  if (list.length > 1 && list.every(element => symbols.has(element))) {
    const elements = [...new Set(list)];
    if (elements.length > 8) throw new CrystalDatabaseError(400, 'CRYSTAL_QUERY_INVALID', 'COD supports searches with up to eight elements.');
    elements.forEach((element, index) => parameters.set(`el${index + 1}`, element)); return parameters;
  }
  // COD expects Hill notation with spaces (O2 Si), rather than a text search for SiO2.
  if (/^(?:[A-Z][a-z]?(?:\d+(?:\.\d+)?)?)+$/.test(query)) {
    const counts = new Map<string, number>();
    for (const [, element, count] of query.matchAll(/([A-Z][a-z]?)(\d+(?:\.\d+)?)?/g)) {
      if (!symbols.has(element) || (count && (!Number.isFinite(Number(count)) || Number(count) <= 0))) throw new CrystalDatabaseError(400, 'CRYSTAL_QUERY_INVALID', 'Use valid chemical symbols and positive stoichiometry.');
      counts.set(element, (counts.get(element) ?? 0) + (count ? Number(count) : 1));
    }
    const order = [...counts.keys()].sort((a, b) => (counts.has('C') ? (a === 'C' ? -2 : a === 'H' ? -1 : 0) - (b === 'C' ? -2 : b === 'H' ? -1 : 0) : 0) || a.localeCompare(b));
    parameters.set('formula', order.map(element => `${element}${counts.get(element) === 1 ? '' : counts.get(element)}`).join(' ')); return parameters;
  }
  const words = query.split(/\s+/);
  if (words.length > 2) throw new CrystalDatabaseError(400, 'CRYSTAL_QUERY_INVALID', 'Use one or two keywords, a simple formula, an element list, or an exact database ID.');
  words.forEach((word, index) => parameters.set(`text${index + 1}`, word)); return parameters;
}
async function retrieve(url: URL, options: RequestInit, fetcher: typeof fetch, maximum: number): Promise<string> {
  const response = await fetcher(url, { ...options, redirect: 'manual' });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    if (response.status === 429) throw new CrystalDatabaseError(429, 'CRYSTAL_DATABASE_RATE_LIMIT', 'The crystal database is rate limited. Wait before searching again.');
    if ([401, 403].includes(response.status) && url.hostname === 'api.materialsproject.org') throw new CrystalDatabaseError(503, 'MP_API_ERROR', 'Materials Project rejected its API key. Update it in Settings → Compute.');
    throw new CrystalDatabaseError(502, 'CRYSTAL_DATABASE_UNAVAILABLE', `The crystal database returned HTTP ${response.status}. No structure was imported.`);
  }
  if (Number(response.headers.get('content-length')) > maximum) { await response.body.cancel(); throw new CrystalDatabaseError(502, 'CRYSTAL_RESPONSE_LIMIT', 'The crystal database response exceeds the import size limit. Use an exact ID.'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maximum) throw new CrystalDatabaseError(502, 'CRYSTAL_RESPONSE_LIMIT', 'The crystal database response exceeds the import size limit. Use an exact ID.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function provenance(database: 'cod' | 'materials-project', id: string, url: string, retrievedAt: string, updatedAt: string | null, format: 'cif' | 'materials-project-json', content: string, lattice: LatticeParameters, atoms: CustomAtom[]) {
  const sourceSha256 = await digest(content);
  return { database, id, url, retrievedAt, sourceUpdatedAt: updatedAt, sourceFormat: format, sourceSha256, structureSha256: await digest(JSON.stringify({ lattice, atoms })), termsUrl: database === 'cod' ? 'https://www.crystallography.net/cod/' : 'https://materialsproject.org/about/terms' };
}
async function normalizeMp(raw: unknown, retrievedAt: string): Promise<CrystalDatabaseMaterial> {
  const document = object(raw), structure = object(document.structure), inputLattice = object(structure.lattice), id = plain(document.material_id), formula = plain(document.formula_pretty);
  if (!/^mp-[a-z0-9]+$/i.test(id) || !formula || !Array.isArray(structure.sites) || !structure.sites.length || structure.sites.length > 5000) throw new Error('Missing structure identity or unsupported site count.');
  let lattice: LatticeParameters;
  if (Array.isArray(inputLattice.matrix)) {
    if (inputLattice.matrix.length !== 3 || inputLattice.matrix.some(row => !Array.isArray(row) || row.length !== 3 || !row.every(finite))) throw new Error('Invalid cell vectors.');
    lattice = latticeFromCellVectors(inputLattice.matrix as CellVectors);
  } else {
    if (!['a', 'b', 'c', 'alpha', 'beta', 'gamma'].every(key => finite(inputLattice[key]))) throw new Error('Incomplete cell metrics.');
    lattice = Object.fromEntries(['a', 'b', 'c', 'alpha', 'beta', 'gamma'].map(key => [key, inputLattice[key]])) as LatticeParameters; cellVectorsFromLattice(lattice);
  }
  lattice.periodic = [true, true, true];
  const atoms = structure.sites.map((rawSite, index): CustomAtom => {
    const site = object(rawSite);
    if (!Array.isArray(site.abc) || site.abc.length !== 3 || !site.abc.every(finite) || !Array.isArray(site.species) || !site.species.length) throw new Error('Incomplete atomic sites.');
    const siteSpecies = site.species.map(rawSpecies => { const entry = object(rawSpecies), element = plain(entry.element); if (!symbols.has(element) || !finite(entry.occu) || entry.occu <= 0 || entry.occu > 1) throw new Error('Invalid species or occupancy.'); return { element, species: element, occupancy: entry.occu }; });
    const occupancy = siteSpecies.reduce((total, entry) => total + entry.occupancy, 0);
    if (occupancy > 1 + 1e-8) throw new Error('Occupancy exceeds one.');
    return { id: `${id}-site-${index + 1}`, species: siteSpecies[0].element, ...(plain(site.label) ? { label: plain(site.label) } : {}), x: site.abc[0], y: site.abc[1], z: site.abc[2], occupancy, siteSpecies };
  });
  if (finite(document.nsites) && document.nsites !== atoms.length) throw new Error('Inconsistent source site count.');
  const symmetry = object(document.symmetry), sourceUrl = `https://materialsproject.org/materials/${id}`, content = JSON.stringify(document), lastUpdated = plain(document.last_updated) || null, evidence = await provenance('materials-project', id, sourceUrl, retrievedAt, lastUpdated, 'materials-project-json', content, lattice, atoms), warning = orderedStructureIssue(atoms);
  return { source: 'Materials Project', materialId: id, formula, spaceGroupSymbol: plain(symmetry.symbol) || 'unknown', ...(finite(symmetry.number) ? { spaceGroupNumber: symmetry.number } : {}), crystalSystem: plain(symmetry.crystal_system) || 'unknown', numSites: atoms.length,
    ...(finite(document.band_gap) ? { bandGap: document.band_gap } : {}), ...(finite(document.energy_above_hull) ? { energyAboveHull: document.energy_above_hull } : {}), ...(finite(document.density) ? { density: document.density } : {}), ...(typeof document.is_stable === 'boolean' ? { isStable: document.is_stable } : {}), ...(typeof document.theoretical === 'boolean' ? { theoretical: document.theoretical } : {}), ...(plain(document.ordering) ? { magneticOrdering: plain(document.ordering) } : {}),
    lastUpdated, sourceUrl, lattice, atoms, sourceData: { filename: `${id}.json`, format: 'materials-project-json', content, sha256: evidence.sourceSha256 }, provenance: evidence, warnings: warning ? [warning] : [] };
}
export async function searchCrystalDatabase(rawQuery: unknown, options: CrystalSearchOptions & { apiKey?: string; signal?: AbortSignal; fetcher?: typeof fetch; materialsProjectSearch?: (query: string, limit: number, signal: AbortSignal, options: CrystalSearchOptions) => Promise<unknown> } = {}): Promise<CrystalDatabaseResult> {
  const query = crystalDatabaseQuery(rawQuery), apiKey = options.apiKey?.trim(), requestedSource = options.source ?? 'auto';
  if (requestedSource !== 'auto' && !Object.hasOwn(crystalSources, requestedSource)) throw new CrystalDatabaseError(400, 'CRYSTAL_SOURCE_INVALID', 'Choose a supported crystal database.');
  if (requestedSource !== 'auto' && (/^(?:cod-)?\d{7}$/i.test(query) && requestedSource !== 'cod' || /^mp-[a-z0-9]+$/i.test(query) && requestedSource !== 'materials-project')) throw new CrystalDatabaseError(400, 'CRYSTAL_SOURCE_INVALID', 'The database ID does not belong to the selected source.');
  const external = optimadeId(query);
  if (external) {
    if (requestedSource !== 'auto' && requestedSource !== external[1]) throw new CrystalDatabaseError(400, 'CRYSTAL_SOURCE_INVALID', 'The database ID does not belong to the selected source.');
    return searchOptimade(query, external[1] as CrystalSource, options, retrieve);
  }
  if (requestedSource !== 'auto' && crystalSources[requestedSource].endpoint) return searchOptimade(query, requestedSource, options, retrieve);
  const codId = query.match(/^(?:cod-)?(\d{7})$/i)?.[1], mpId = /^mp-[a-z0-9]+$/i.test(query), database = (codId ? 'cod' : mpId ? 'materials-project' : requestedSource === 'auto' ? apiKey || options.materialsProjectSearch ? 'materials-project' : 'cod' : requestedSource) as 'cod' | 'materials-project';
  if (requestedSource !== 'auto' && (codId && requestedSource !== 'cod' || mpId && requestedSource !== 'materials-project')) throw new CrystalDatabaseError(400, 'CRYSTAL_SOURCE_INVALID', 'The database ID does not belong to the selected source.');
  if (database === 'materials-project' && !apiKey && !options.materialsProjectSearch) throw new CrystalDatabaseError(503, 'MP_API_KEY_MISSING', 'Add your Materials Project API key in Settings → Compute. Choose COD for public searches without an account.');
  const { limit, offset, filters, sort } = validateCrystalOptions(database, options), fetcher = options.fetcher ?? fetch, signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000), retrievedAt = new Date().toISOString(), warnings: string[] = [], materials: CrystalDatabaseMaterial[] = [];
  let total: number | null = null, hasMore = false;
  const request = { headers: { Accept: 'application/json', 'User-Agent': 'PhyniteLab (crystal structure lookup)' }, signal };
  try {
    if (database === 'materials-project') {
      const endpoint = new URL('https://api.materialsproject.org/materials/summary/'), key = mpId ? 'material_ids' : /^[A-Z][a-z]?(?:-[A-Z][a-z]?)+$/.test(query) ? 'chemsys' : /^[A-Z][a-z]?(?:[ ,]+[A-Z][a-z]?)+$/.test(query) ? 'elements' : 'formula';
      const parameters = new URLSearchParams({ [key]: key === 'elements' ? query.split(/[ ,]+/).join(',') : query, _fields: fields, _limit: String(limit), _sort_fields: sort === 'default' || sort === 'energy-above-hull' ? 'energy_above_hull' : (sort.startsWith('-') ? '-' : '') + (sort.endsWith('sites') ? 'nsites' : 'band_gap') });
      if (offset) parameters.set('_skip', String(offset));
      const propertyNames = { spaceGroup: 'spacegroup_number', minSites: 'nsites_min', maxSites: 'nsites_max', minBandGap: 'band_gap_min', maxBandGap: 'band_gap_max', maxEnergyAboveHull: 'energy_above_hull_max' };
      for (const [name, value] of Object.entries(filters)) if (value !== undefined) parameters.set(propertyNames[name as keyof typeof propertyNames], String(value));
      endpoint.search = parameters.toString();
      const payload = object(options.materialsProjectSearch
        ? await options.materialsProjectSearch(query, limit, signal, options)
        : JSON.parse(await retrieve(endpoint, { ...request, headers: { ...request.headers, 'X-API-KEY': apiKey! } }, fetcher, 5_000_000)));
      if (!Array.isArray(payload.data)) throw new CrystalDatabaseError(502, 'CRYSTAL_RESPONSE_INVALID', 'Materials Project returned an unsupported response. No structure was imported.');
      const count = object(payload.meta).total_doc;
      total = Number.isSafeInteger(count) && (count as number) >= 0 ? count as number : null;
      hasMore = payload.data.length > 0 && (total === null ? payload.data.length >= limit : offset + payload.data.length < total);
      for (const raw of payload.data.slice(0, limit)) { try {
        const material = await normalizeMp(raw, retrievedAt);
        if (!crystalMatchesFilters(material, filters)) throw new Error('The source did not honor the filters.');
        materials.push(material);
      } catch { warnings.push('A Materials Project record was omitted because its geometry, elements, occupancies or selected property filters could not be validated.'); } }
      validateCrystalOrder(materials, sort);
    } else {
      let records: Record<string, unknown>[];
      if (codId) { records = offset ? [] : [{ file: codId }]; total = 1; }
      else {
        const endpoint = new URL('https://www.crystallography.net/cod/result.php'); endpoint.search = codQueryParameters(query).toString();
        const payload = JSON.parse(await retrieve(endpoint, request, fetcher, 2_000_000));
        if (!Array.isArray(payload)) throw new CrystalDatabaseError(502, 'CRYSTAL_RESPONSE_INVALID', 'COD returned an unsupported response. No structure was imported.');
        const available = payload.filter(value => /^\d{7}$/.test(String(object(value).file)) && /coordinates/i.test(String(object(value).flags ?? '')));
        total = available.length; hasMore = offset + limit < total;
        records = available.slice(offset, offset + limit).map(object);
      }
      for (const record of records) {
        signal.throwIfAborted();
        try {
          const file = String(record.file), content = await retrieve(new URL(`https://www.crystallography.net/cod/${file}.cif`), { ...request, headers: { ...request.headers, Accept: 'text/plain' } }, fetcher, 2_000_000), parsed = parseStructureText(content, `${file}.cif`);
          if (parsed.atoms.some(atom => !symbols.has(atom.species))) throw new Error('Unknown element.');
          parsed.lattice.periodic = [true, true, true];
          const materialId = `cod-${file}`, sourceUrl = `https://www.crystallography.net/cod/${file}.html`, lastUpdated = plain(record.date) || null, formula = plain(record.calcformula ?? record.formula).replace(/^-\s*|\s*-$/g, '').trim() || plain(content.match(/^_chemical_formula_sum\s+['"]?([^'"\r\n]+)['"]?/m)?.[1]) || `COD ${file}`, spaceGroupNumber = Number(record.sgNumber || content.match(/^_(?:space_group_IT_number|symmetry_Int_Tables_number)\s+(\d+)/im)?.[1]), evidence = await provenance('cod', materialId, sourceUrl, retrievedAt, lastUpdated, 'cif', content, parsed.lattice, parsed.atoms), warning = orderedStructureIssue(parsed.atoms);
          materials.push({ source: 'Crystallography Open Database', materialId, formula, spaceGroupSymbol: plain(record.sg) || plain(content.match(/^_(?:space_group_name_H-M_alt|symmetry_space_group_name_H-M)\s+['"]([^'"\r\n]+)['"]/im)?.[1]) || 'unknown', ...(Number.isInteger(spaceGroupNumber) && spaceGroupNumber >= 1 && spaceGroupNumber <= 230 ? { spaceGroupNumber } : {}), crystalSystem: 'unknown', numSites: parsed.atoms.length, lastUpdated, sourceUrl, lattice: parsed.lattice, atoms: parsed.atoms, sourceData: { filename: `${file}.cif`, format: 'cif', content, sha256: evidence.sourceSha256 }, provenance: evidence, warnings: warning ? [warning] : [] });
        } catch (failure) { if (codId || failure instanceof CrystalDatabaseError || signal.aborted) throw failure; warnings.push(`COD ${record.file} was omitted because its CIF could not be validated. No substitute structure was used.`); }
      }
    }
    signal.throwIfAborted();
    return { materials, query, source: database === 'cod' ? 'Crystallography Open Database' : 'Materials Project', retrievedAt, warnings: [...new Set(warnings)], pagination: { offset, limit, total, hasMore, nextOffset: hasMore ? offset + limit : null } };
  } catch (failure) {
    options.signal?.throwIfAborted();
    if (failure instanceof CrystalDatabaseError) throw failure;
    throw new CrystalDatabaseError(502, signal.aborted ? 'CRYSTAL_DATABASE_TIMEOUT' : 'CRYSTAL_DATABASE_UNAVAILABLE', signal.aborted ? 'The crystal database lookup timed out. Retry with an exact database ID.' : 'The crystal database could not provide a validated structure. Check the connection or import a source CIF manually.');
  }
}
