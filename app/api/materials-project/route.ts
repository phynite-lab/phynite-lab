import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const SUMMARY_ENDPOINT = 'https://api.materialsproject.org/materials/summary/';
const FIELDS = [
  'material_id',
  'formula_pretty',
  'structure',
  'symmetry',
  'nsites',
  'band_gap',
  'energy_above_hull',
  'is_stable',
  'density',
  'ordering',
  'theoretical',
  'last_updated',
].join(',');

type MpSite = {
  label?: string;
  species?: Array<{ element?: string; occu?: number }>;
  abc?: [number, number, number];
};

type MpDocument = {
  material_id?: string;
  formula_pretty?: string;
  structure?: {
    lattice?: { a?: number; b?: number; c?: number; alpha?: number; beta?: number; gamma?: number };
    sites?: MpSite[];
  };
  symmetry?: { symbol?: string; number?: number; crystal_system?: string };
  nsites?: number;
  band_gap?: number;
  energy_above_hull?: number;
  is_stable?: boolean;
  density?: number;
  ordering?: string;
  theoretical?: boolean;
  last_updated?: string;
};

function queryFilter(query: string) {
  if (/^mp-[a-z0-9]+$/i.test(query)) return { key: 'material_ids', value: query.toLowerCase() };
  if (/^[A-Z][a-z]?(?:-[A-Z][a-z]?)+$/.test(query)) return { key: 'chemsys', value: query };
  if (/^[A-Z][a-z]?(?:[ ,]+[A-Z][a-z]?)+$/.test(query)) {
    return { key: 'elements', value: query.split(/[ ,]+/).filter(Boolean).join(',') };
  }
  return { key: 'formula', value: query };
}

function finite(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalize(document: MpDocument) {
  const lattice = document.structure?.lattice;
  const sites = document.structure?.sites ?? [];
  if (!document.material_id || !document.formula_pretty || !lattice || !sites.length) return null;

  return {
    materialId: document.material_id,
    formula: document.formula_pretty,
    spaceGroupSymbol: document.symmetry?.symbol ?? 'P1',
    spaceGroupNumber: finite(document.symmetry?.number, 1),
    crystalSystem: document.symmetry?.crystal_system ?? 'unknown',
    numSites: finite(document.nsites, sites.length),
    bandGap: finite(document.band_gap),
    energyAboveHull: finite(document.energy_above_hull),
    isStable: Boolean(document.is_stable),
    density: finite(document.density),
    magneticOrdering: document.ordering ?? 'Unknown',
    theoretical: Boolean(document.theoretical),
    lastUpdated: document.last_updated ?? null,
    lattice: {
      a: finite(lattice.a, 1),
      b: finite(lattice.b, 1),
      c: finite(lattice.c, 1),
      alpha: finite(lattice.alpha, 90),
      beta: finite(lattice.beta, 90),
      gamma: finite(lattice.gamma, 90),
    },
    atoms: sites.map((site, index) => ({
      id: `${document.material_id}-site-${index + 1}`,
      species: site.species?.find((species) => finite(species.occu, 1) > 0)?.element ?? site.label ?? 'X',
      x: finite(site.abc?.[0]),
      y: finite(site.abc?.[1]),
      z: finite(site.abc?.[2]),
    })),
  };
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.MP_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Materials Project is not connected yet.', code: 'MP_API_KEY_MISSING' },
      { status: 503 },
    );
  }

  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  const limit = Math.max(1, Math.min(30, Number(request.nextUrl.searchParams.get('limit')) || 20));
  if (!query || query.length > 80 || !/^[A-Za-z0-9*+\-., ()]+$/.test(query)) {
    return NextResponse.json({ error: 'Use a formula, element list, chemical system, or MP-ID.' }, { status: 400 });
  }

  const filter = queryFilter(query);
  const endpoint = new URL(SUMMARY_ENDPOINT);
  endpoint.searchParams.set(filter.key, filter.value);
  endpoint.searchParams.set('_fields', FIELDS);
  endpoint.searchParams.set('_limit', String(limit));
  endpoint.searchParams.set('_sort_fields', 'energy_above_hull');

  try {
    const response = await fetch(endpoint, {
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json() as { data?: MpDocument[]; message?: string; detail?: string };
    if (!response.ok) {
      return NextResponse.json(
        { error: payload.message ?? payload.detail ?? 'Materials Project rejected the request.', code: 'MP_API_ERROR' },
        { status: response.status },
      );
    }

    const materials = (payload.data ?? []).map(normalize).filter((material) => material !== null);
    return NextResponse.json(
      { materials, query, source: 'Materials Project', retrievedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Materials Project is temporarily unavailable.', code: 'MP_NETWORK_ERROR' },
      { status: 502 },
    );
  }
}
