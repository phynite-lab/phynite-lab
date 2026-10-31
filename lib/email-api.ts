import { phyniteApi } from './phynite-api.ts';

export type EmailPreferences = {
  locale: 'en' | 'id'; jobs: boolean; inbox: boolean; product: boolean;
  adminWaitlist: boolean; adminContact: boolean; adminAlerts: boolean;
};
export type EmailDelivery = {
  id: string; kind?: string; event?: string; status: string; deliveryStatus?: string;
  createdAt?: string; sentAt?: string; attempts: number; lastError?: string;
};
export type SupportMessage = {
  id: string; direction: 'incoming' | 'outgoing'; body: string; subject: string; createdAt: string;
  attachmentsOmitted?: boolean; status?: string; deliveryStatus?: string;
};
export type EmailCampaign = {
  idempotencyKey: string; title: string; titleId: string; body: string; bodyId: string; path: string;
  audience: { type: 'broadcast' | 'everyone' } | { type: 'users'; userIds: string[] } | { type: 'waitlist'; entryIds: string[] };
};
export type EmailRecipientSummary = { total: number; eligible: number; excluded: number; duplicates: number };
export type EmailPreview = { subject: string; html: string; text: string };
export const phyniteEmail = {
  preferences: () => phyniteApi<{ preferences: EmailPreferences }>('/v1/notification-preferences'),
  savePreferences: (preferences: EmailPreferences) => phyniteApi<{ preferences: EmailPreferences }>('/v1/notification-preferences', { method: 'PUT', body: preferences }),
  status: () => phyniteApi<{ from: string; provider?: 'ses' | 'resend'; configured?: boolean; ready: boolean; deliveryEnabled: boolean; productionAccess: boolean; domainVerified: boolean; sendingEnabled: boolean; productionReviewStatus?: string }>('/v1/developer/email/status'),
  deliveries: (cursor = '') => phyniteApi<{ deliveries: EmailDelivery[]; nextCursor: string | null }>(`/v1/developer/email/deliveries?${new URLSearchParams({ cursor })}`),
  preview: (campaign: EmailCampaign) => phyniteApi<{ previews: Record<'en' | 'id', EmailPreview>; recipients?: EmailRecipientSummary }>('/v1/developer/email/campaigns/preview', { method: 'POST', body: campaign }),
  send: (campaign: EmailCampaign) => phyniteApi<{ id: string; status: string; recipientCount?: number }>('/v1/developer/email/campaigns', { method: 'POST', body: campaign }),
  conversation: (id: string) => phyniteApi<{ messages: SupportMessage[]; subject: string; replyTo?: string }>(`/v1/developer/inquiries/${encodeURIComponent(id)}/conversation`),
  reply: (id: string, body: string, locale: 'en' | 'id', idempotencyKey: string) => phyniteApi<{ reply: { id: string; status: string } }>(`/v1/developer/inquiries/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { body, locale, idempotencyKey } }),
};
