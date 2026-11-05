/** Server-only adapter. The local native service keeps the Materials Project key in its vault. */
import { CrystalDatabaseError, crystalDatabaseQuery, searchCrystalDatabase, type CrystalDatabaseSource } from './crystal-database.ts';
import { localAppMode } from './local-runtime.ts';

async function localMaterialsProject(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`${process.env.PHYNITE_LOCAL_API_URL!.replace(/\/$/, '')}/__local/materials-project${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${process.env.PHYNITE_LOCAL_SERVICE_TOKEN}` },
      cache: 'no-store', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
    });
    const value: unknown = await response.json();
    const body = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    if (!response.ok) {
      throw new CrystalDatabaseError(response.status, typeof body?.code === 'string' ? body.code : 'MP_API_ERROR',
        typeof body?.error === 'string' ? body.error : 'Materials Project is unavailable. Check its connection in Settings → Compute.');
    }
    return body;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof CrystalDatabaseError) throw error;
    throw new CrystalDatabaseError(503, 'MP_CONNECTION_UNAVAILABLE', 'The Materials Project connection is unavailable. Check Settings → Compute or restart Phynite Lab.');
  }
}

export async function searchServerCrystalDatabase(rawQuery: unknown, options: { source?: CrystalDatabaseSource; signal?: AbortSignal; limit?: number } = {}) {
  const query = crystalDatabaseQuery(rawQuery), source = options.source ?? 'auto';
  // COD never requires local credentials or a native-service request.
  if (!localAppMode() || source === 'cod' || /^(?:cod-)?\d{7}$/i.test(query)) {
    return searchCrystalDatabase(query, { ...options, apiKey: process.env.MP_API_KEY });
  }
  const useMaterialsProject = source === 'materials-project' || /^mp-[a-z0-9]+$/i.test(query)
    || (source === 'auto' && (await localMaterialsProject('', options.signal)).configured === true);
  return searchCrystalDatabase(query, {
    ...options,
    ...(useMaterialsProject ? { materialsProjectSearch: (value: string, limit: number, signal: AbortSignal) =>
      localMaterialsProject(`/search?${new URLSearchParams({ q: value, limit: String(limit) })}`, signal) } : {}),
  });
}
