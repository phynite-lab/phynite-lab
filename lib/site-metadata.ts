import type { Metadata } from 'next';
import { GUIDE_TOPIC_IDS, guidePath } from './guide-routing.ts';
import type { Locale } from './locale.ts';
import { SITE_FOUNDERS } from './site-company.ts';
import { supportEmail } from './support.ts';

export const PUBLIC_PATHS = ['/', '/about', '/pricing', '/waitlist', '/contact', '/guide', '/privacy', '/terms'] as const;
export const PRIVATE_PATHS = ['/account', '/billing', '/workspace', '/projects', '/calculation', '/md', '/ai', '/storage', '/inbox', '/developer', '/login', '/register', '/api'] as const;
export const SITE_NAME = 'Phynite Lab';
export const HOME_TITLE = 'Phynite Lab — DFT, Molecular Dynamics & Scientific Figures';
export const SITE_DESCRIPTION = 'A computational materials science workspace for Quantum ESPRESSO DFT, LAMMPS molecular dynamics, and publication-ready scientific figures.';
export const SOCIAL_IMAGE_PATH = '/brand/phynite-social-v1.png';
export const AI_SEARCH_CRAWLERS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User'] as const;

export function publicCrawlerRules() {
  // A specific user-agent group replaces the wildcard group; exclusions must be repeated.
  const publicAccess = () => ({ allow: '/', disallow: [...PRIVATE_PATHS] });
  return [
    { userAgent: '*', ...publicAccess() },
    { userAgent: [...AI_SEARCH_CRAWLERS], ...publicAccess() },
  ];
}

export function publicPageMetadata({ path, title, description, locale = 'en', languages }: {
  path: string; title: string; description: string; locale?: Locale; languages?: Record<string, string>;
}): Metadata {
  const origin = publicSiteOrigin();
  const url = new URL(path, origin).href;
  const image = {
    url: new URL(SOCIAL_IMAGE_PATH, origin).href,
    width: 1200, height: 630,
    alt: locale === 'id' ? 'Logo Phynite Lab dan wordmark phynite-lab Geist Pixel' : 'Phynite Lab logo and phynite-lab Geist Pixel wordmark',
  };
  return {
    title, description,
    alternates: { canonical: url, ...(languages ? { languages } : {}) },
    openGraph: { title, description, url, siteName: SITE_NAME, type: 'website', locale: locale === 'id' ? 'id_ID' : 'en_US', images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [{ url: image.url, alt: image.alt }] },
  };
}

export function publicSitemapPaths(): string[] {
  return [...PUBLIC_PATHS, guidePath('id'), ...GUIDE_TOPIC_IDS.flatMap(topic => [guidePath('en', topic), guidePath('id', topic)])];
}

export function siteStructuredData() {
  const origin = publicSiteOrigin();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${origin}/#organization`, name: SITE_NAME, alternateName: ['phynite-lab', 'Phynite'], description: SITE_DESCRIPTION, url: `${origin}/`, logo: `${origin}/brand/phynite-favicon-3312f122.png`, sameAs: ['https://github.com/phynite-lab'], founder: SITE_FOUNDERS.map(founder => ({ '@type': 'Person', name: founder.name, sameAs: [founder.linkedin] })), contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: supportEmail, url: `${origin}/contact` } },
      { '@type': 'WebSite', '@id': `${origin}/#website`, name: SITE_NAME, alternateName: ['phynite-lab', 'Phynite'], url: `${origin}/`, publisher: { '@id': `${origin}/#organization` } },
    ],
  };
}

export function publicSiteOrigin(configured = process.env.PHYNITE_PUBLIC_APP_URL): string {
  const url = new URL(configured?.trim() || 'https://phynitelab.com');
  const localLoopback = process.env.PHYNITE_BUILD_TARGET === 'local' && process.env.PHYNITE_APP_MODE === 'local'
    && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && Boolean(url.port);
  if (url.protocol !== 'https:' && !localLoopback || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PHYNITE_PUBLIC_APP_URL must be an HTTPS origin without a path or credentials.');
  }
  return url.origin;
}

export function privatePage(path: string): boolean {
  return PRIVATE_PATHS.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}
