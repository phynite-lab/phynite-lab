import { accountRequest } from './account-api.ts';

export type PaymentMethod = 'VIRTUAL_ACCOUNT_DOKU' | 'QRIS';
export type PaymentPrice = { baseAmountIdr: number; paymentFeeIdr: number; amountIdr: number };
export type PaymentStatus = 'INITIALIZING' | 'PENDING' | 'PAID' | 'EXPIRED' | 'REJECTED';
export type PaymentInstructions =
  | { type: 'virtual-account'; number: string; provider: string; expiresAt: string; steps: string[]; stepsId?: string[] }
  | { type: 'qris'; qrContent: string; expiresAt: string };
export type PaymentOffer = {
  id: string; name: string; kind: 'quanta' | 'storage'; amountIdr: number; currency: 'IDR';
  baseAmountIdr?: number; paymentFeeIdr?: number;
  quanta?: number; storageBytes?: number; periodDays?: number;
  prices?: Partial<Record<PaymentMethod, PaymentPrice>>;
};
export type PaymentOrder = Omit<PaymentOffer, 'id'> & {
  id: string; offerId: string; status: PaymentStatus;
  environment: 'sandbox' | 'production'; createdAt: string; paidAt?: string; checkoutUrl?: string;
  nextCheckAt?: number; checkoutError?: string; paymentMethods?: string[];
  paymentMethod?: PaymentMethod; integration?: 'direct' | 'hosted'; instructions?: PaymentInstructions;
  expiresAt?: string; fulfilledUntil?: string; convertedSeconds?: number; lastAttemptStatus?: 'FAILED';
};
export type BillingPayments = {
  available: boolean; environment: 'sandbox' | 'production' | null; offers: PaymentOffer[]; payments: PaymentOrder[];
  idrPerQuanta?: number;
  customQuanta?: { minimum: number; maximum: number; step: number };
  paymentMethods?: PaymentMethod[];
  subscription: { offerId: string; storageBytes: number; expiresAt: string; active: boolean; renewal: 'manual' } | null;
};

export function trustedCheckoutUrl(value: string, environment: 'sandbox' | 'production'): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('DOKU checkout link is invalid.'); }
  const hosts = environment === 'production' ? ['jokul.doku.com', 'checkout.doku.com'] : ['sandbox.doku.com'];
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.port || url.username || url.password || !['/checkout/link/', '/checkout-link-v2/'].some(path => url.pathname.startsWith(path))) {
    throw new Error('DOKU checkout link is invalid.');
  }
  return url.href;
}

export const billingPaymentsRequest = (offerId?: string) => accountRequest<BillingPayments>(
  '/payments' + (offerId?.startsWith('quanta-custom-') ? '?' + new URLSearchParams({ offer: offerId }) : ''),
);
export const paymentRequest = (id: string) => {
  if (!/^PL[A-F0-9]{26}$/.test(id)) throw new Error('Payment identity is invalid.');
  return accountRequest<{ payment: PaymentOrder }>(`/payments/${id}`);
};
export const checkoutRequest = (offerId: string, requestId: string, paymentMethod?: PaymentMethod) =>
  accountRequest<{ payment: PaymentOrder }>('/payments/checkout', 'POST', { offerId, requestId, ...(paymentMethod ? { paymentMethod } : {}) });
export const paymentHistoryRequest = (status: PaymentStatus | 'ALL' = 'ALL', cursor?: string) => {
  const query = new URLSearchParams({ status });
  if (cursor) query.set('cursor', cursor);
  return accountRequest<{ payments: PaymentOrder[]; nextCursor: string | null }>(`/payments/history?${query}`);
};

export const checkoutRequestKey = (owner: string, environment: string, offer: string, method: PaymentMethod) =>
  `phynite:checkout:${owner}:${environment}:${offer}:${method}`;
export const reconcilePaymentRequest = (id: string) => {
  if (!/^PL[A-F0-9]{26}$/.test(id)) throw new Error('Payment identity is invalid.');
  return accountRequest<{ payment: PaymentOrder }>(`/payments/${id}/reconcile`, 'POST', {});
};
