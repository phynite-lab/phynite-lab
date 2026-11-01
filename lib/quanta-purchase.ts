import type { BillingPayments } from './billing-api.ts';

export type QuantaPurchaseCatalog = Pick<BillingPayments, 'offers' | 'idrPerQuanta' | 'customQuanta'>;

/** Integer hundredths bind the quantity to an offer and its retry identity. */
export function quantaPurchase(value: string, catalog: QuantaPurchaseCatalog) {
  const match = /^(\d{1,8})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const hundredths = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  const quanta = hundredths / 100;
  const preset = catalog.offers.find(offer => offer.kind === 'quanta' && offer.quanta === quanta);
  if (preset) return { quanta, offerId: preset.id, baseAmountIdr: preset.baseAmountIdr ?? preset.amountIdr };
  const limits = catalog.customQuanta;
  if (!limits || !catalog.idrPerQuanta || quanta < limits.minimum || quanta > limits.maximum || limits.step !== 0.01) return null;
  return { quanta, offerId: `quanta-custom-${hundredths}`, baseAmountIdr: Math.ceil(hundredths * catalog.idrPerQuanta / 100) };
}

/** A pricing link only prefills a reviewed amount; checkout still owns prices. */
export function quantaQuantityFromSearch(search: string, catalog: QuantaPurchaseCatalog): string | null {
  const values = new URLSearchParams(search).getAll('quanta');
  if (values.length !== 1 || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(values[0])) return null;
  const purchase = quantaPurchase(values[0], catalog);
  return purchase && String(purchase.quanta) === values[0] ? values[0] : null;
}
