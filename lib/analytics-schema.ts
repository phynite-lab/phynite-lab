import { guideRoute, isGuideTopic } from './guide-routing.ts';

export const ANALYTICS_EVENTS = [
  'page_view', 'engagement', 'performance', 'pricing_view', 'access_request',
  'waitlist_submit', 'contact_submit', 'registration_complete', 'workspace_feature',
] as const;

export type AnalyticsEventName = typeof ANALYTICS_EVENTS[number];

const PUBLIC_PAGES = new Set(['/', '/about', '/pricing', '/demo', '/waitlist', '/contact', '/register', '/login', '/guide', '/privacy', '/terms']);
const WORKSPACE_PAGES = new Set(['/workspace', '/calculation', '/md', '/storage', '/inbox', '/billing']);
const ACCOUNT_PAGES = new Set(['profile', 'usage', 'billing', 'computer', 'preferences', 'compute', 'storage', 'appearance', 'notifications', 'privacy']);
export const WORKSPACE_FEATURES = new Set(['dft', 'md', 'figures', 'storage', 'inbox', 'projects']);

export function analyticsPage(pathname: string): { area: 'public' | 'workspace'; page: string } | null {
  const guide = guideRoute(pathname);
  if (guide && (!guide.topic || isGuideTopic(guide.topic))) return { area: 'public', page: '/guide' };
  if (PUBLIC_PAGES.has(pathname)) return { area: 'public', page: pathname };
  if (WORKSPACE_PAGES.has(pathname)) return { area: 'workspace', page: pathname };
  if (pathname === '/account') return { area: 'workspace', page: pathname };
  if (/^\/account\/[a-z]+$/.test(pathname) && ACCOUNT_PAGES.has(pathname.split('/')[2])) return { area: 'workspace', page: pathname };
  for (const prefix of WORKSPACE_PAGES) {
    if (pathname.startsWith(`${prefix}/`)) return { area: 'workspace', page: `${prefix}/detail` };
  }
  return null;
}

export function safeCampaign(value: string | null): string {
  return value && /^[a-zA-Z0-9_-]{1,40}$/.test(value) ? value.toLowerCase() : '';
}

export function analyticsConsentAllowed(choice: unknown): boolean {
  return choice === 'accepted';
}
