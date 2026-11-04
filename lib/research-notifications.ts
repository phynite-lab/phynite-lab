export type ResearchNotificationCategory = 'run-failed' | 'runtime-failed' | 'resource-limit' | 'low-disk' | 'run-completed';
export type ResearchNotification = { id: string; category: ResearchNotificationCategory; title: string; detail: string; createdAt: string; evidenceIds?: string[] };

export function researchNotificationId(category: ResearchNotificationCategory, subjectId: string, fingerprint = ''): string { return `research:${category}:${subjectId}:${fingerprint}`.slice(0, 500); }

export function makeResearchNotification(input: Omit<ResearchNotification, 'id' | 'createdAt'> & { subjectId: string; fingerprint?: string }, createdAt = new Date().toISOString()): ResearchNotification {
  return { ...input, id: researchNotificationId(input.category, input.subjectId, input.fingerprint), createdAt };
}

/** Device-only deduplication helper; callers persist the returned IDs in local storage. */
export function unseenResearchNotifications(notifications: ResearchNotification[], seen: ReadonlySet<string>): ResearchNotification[] {
  return notifications.filter(item => !seen.has(item.id));
}

export function notificationForFailure(subjectId: string, phase: string, detail: string, evidenceIds: string[] = []): ResearchNotification {
  const category: ResearchNotificationCategory = phase === 'resource' ? 'resource-limit' : phase === 'preflight' || phase === 'solver' || phase === 'sandbox' || phase === 'artifact' ? 'run-failed' : 'run-failed';
  return makeResearchNotification({ category, subjectId, title: category === 'resource-limit' ? 'Resource limit reached' : 'Research run failed', detail, evidenceIds, fingerprint: `${phase}:${detail}` }, new Date().toISOString());
}
