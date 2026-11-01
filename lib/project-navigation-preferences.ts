import { NavigationPreferenceError, type NavigationEnvelope, type NavigationTransport } from './navigation-preferences.ts';
export type ProjectNavigationPreferences = { version: 2; pinnedProjectIds: string[]; sidebarDocked: boolean };
export function parseProjectNavigationPreferences(value: unknown): ProjectNavigationPreferences {
  if (!value || typeof value !== 'object') throw new Error('Invalid project navigation preferences.');
  const raw = value as ProjectNavigationPreferences;
  if (Object.keys(raw).sort().join() !== ['version', 'pinnedProjectIds', 'sidebarDocked'].sort().join() || raw.version !== 2 || typeof raw.sidebarDocked !== 'boolean' || !Array.isArray(raw.pinnedProjectIds) || raw.pinnedProjectIds.length > 256 || raw.pinnedProjectIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) || new Set(raw.pinnedProjectIds).size !== raw.pinnedProjectIds.length) throw new Error('Invalid project navigation preferences.');
  return { version: 2, pinnedProjectIds: [...raw.pinnedProjectIds], sidebarDocked: raw.sidebarDocked };
}
async function request(method: string, value?: NavigationEnvelope): Promise<NavigationEnvelope> {
  const preferences: ProjectNavigationPreferences | undefined = value ? { version: 2, pinnedProjectIds: value.preferences.pinnedProjectKeys.filter(key => key.startsWith('md:')).map(key => key.slice(3)), sidebarDocked: value.preferences.sidebarDocked } : undefined;
  const result = await fetch('/api/phynite/v1/navigation-preferences/v2', { method, cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(value ? { body: JSON.stringify({ preferences, baseRevision: value.revision, unresolvedProjectKeys: value.preferences.pinnedProjectKeys.filter(key => key.startsWith('dft:')) }) } : {}) });
  if (!result.ok) throw new NavigationPreferenceError('Project navigation could not be synchronized.', result.status);
  const raw = await result.json() as { preferences: unknown; revision: number; unresolvedProjectKeys?: unknown[] }, parsed = parseProjectNavigationPreferences(raw.preferences);
  if (!Number.isSafeInteger(raw.revision) || raw.revision < 0) throw new Error('Invalid navigation revision.');
  return { revision: raw.revision, preferences: { version: 1, pinnedFeatureIds: ['projects'], pinnedProjectKeys: [...parsed.pinnedProjectIds.map(id => `md:${id}`), ...(Array.isArray(raw.unresolvedProjectKeys) ? raw.unresolvedProjectKeys.filter((key: unknown): key is string => typeof key === 'string' && /^dft:[A-Za-z0-9_-]{1,200}$/.test(key)) : [])], sidebarDocked: parsed.sidebarDocked } };
}
/** Reuse the tested intent queue while keeping v2 storage and API isolated. */
export const projectNavigationTransport: NavigationTransport = { get: () => request('GET'), put: value => request('PUT', value) };
