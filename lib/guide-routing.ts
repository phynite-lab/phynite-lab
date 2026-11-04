import type { Locale } from './locale.ts';

// Shared by routing and navigation without loading the complete guide datasets.
export const GUIDE_TOPIC_IDS = ['getting-started', 'workflow', 'npm-local-app', 'local-compute', 'project', 'structure', 'edit', 'periodicity', 'slab-workflow', 'quickstart-silicon', 'calculation', 'configure', 'convergence', 'execution', 'quickstart-md', 'md-workflows', 'ai-providers', 'cloud-sync', 'account', 'saving', 'billing', 'storage-backup', 'settings-reference', 'language', 'results', 'research-history', 'figures', 'alignment', 'studies', 'reuse', 'advanced', 'export', 'publication', 'troubleshooting', 'local-troubleshooting', 'diagnostics', 'tools-reference', 'shortcuts', 'field-reference', 'roadmap', 'reference'] as const;
export type GuideTopicId = typeof GUIDE_TOPIC_IDS[number];

export function isGuideTopic(topic: string): topic is GuideTopicId {
  return (GUIDE_TOPIC_IDS as readonly string[]).includes(topic);
}

export function guidePath(locale: Locale, topic = ''): string {
  const base = locale === 'id' ? '/id/guide' : '/guide';
  return topic ? `${base}/${encodeURIComponent(topic)}` : base;
}

export function guideRoute(pathname: string | null): { locale: Locale; topic: string } | null {
  const match = pathname?.match(/^\/(id\/)?guide(?:\/([a-z0-9-]+))?\/?$/);
  return match ? { locale: match[1] ? 'id' : 'en', topic: match[2] ?? '' } : null;
}

export function legacyGuideDestination(pathname: string, hash: string, search = ''): string | null {
  const route = guideRoute(pathname);
  const match = hash.match(/^#([a-z0-9-]+)(?:\/([1-9]\d*))?$/);
  if (!route || !match) return null;
  const [, topic, block] = match;
  if (topic === 'overview' && !block) return `${guidePath(route.locale)}${search}`;
  if (!isGuideTopic(topic)) return null;
  return `${guidePath(route.locale, topic)}${search}${block ? `#docs-${topic}-${block}` : ''}`;
}
